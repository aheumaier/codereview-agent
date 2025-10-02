import Anthropic from '@anthropic-ai/sdk';
import { wrapError } from './utils/errorHelpers.js';
import { retryWithBackoff, isRetryableError } from './utils/retry.js';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Review module using Claude for PR analysis
 */
class Review {
  constructor() {
    this.anthropic = null;
    this.promptTemplate = null; // Cache for loaded prompt template
  }

  /**
   * Load review prompt template from file (lazy initialization)
   * @returns {string} Prompt template content
   */
  getPromptTemplate() {
    if (!this.promptTemplate) {
      // Use path relative to project root (works in both prod and test)
      const promptPath = join(process.cwd(), 'data', 'promt.md');
      this.promptTemplate = readFileSync(promptPath, 'utf-8');
    }
    return this.promptTemplate;
  }

  /**
   * Initialize Anthropic client
   * @param {string} apiKey - Anthropic API key
   */
  initializeClient(apiKey) {
    if (!this.anthropic) {
      this.anthropic = new Anthropic({
        apiKey: apiKey
      });
    }
  }

  /**
   * Review a PR using Claude
   * @param {Object} context - PR context from context builder
   * @param {Object} config - Configuration
   * @returns {Promise<Object>} Review results
   */
  async reviewPR(context, config) {
    try {
      this.initializeClient(config.claude.apiKey);

      // Check if parallel reviews are enabled
      const parallelConfig = config.review?.parallelReviews;
      if (parallelConfig?.enabled) {
        return await this.runParallelReviews(context, config);
      }

      // Single review flow (existing logic)
      const prompt = this.buildReviewPrompt(context, config);

      const response = await retryWithBackoff(
        async () => this.anthropic.messages.create({
          model: config.claude.model,
          max_tokens: config.claude.maxTokens,
          temperature: config.claude.temperature || 0,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ]
        }),
        {
          maxRetries: 3,
          initialDelay: 2000, // Longer initial delay for LLM APIs
          shouldRetry: (error) => {
            // Check for rate limiting or overloaded responses
            if (error.status === 429 || error.status === 529) {
              return true;
            }
            // Use default retry logic for other errors
            return isRetryableError(error);
          },
          onRetry: (error, attempt, delay) => {
            console.log(`  Retrying Claude API call (attempt ${attempt}/3) after ${delay}ms: ${error.message || error.status}`);
          }
        }
      );

      const reviewText = response.content[0].text;
      return this.parseReviewResponse(reviewText);

    } catch (error) {
      const wrappedError = wrapError(error, 'Review failed');
      console.error('Review error:', wrappedError.getFullMessage());
      return {
        error: 'Review failed',
        decision: 'error',
        comments: [],
        summary: `Failed to review PR: ${error.message}`
      };
    }
  }

  /**
   * Run multiple reviews in parallel and synthesize results
   * @param {Object} context - PR context
   * @param {Object} config - Configuration
   * @returns {Promise<Object>} Synthesized review result
   */
  async runParallelReviews(context, config) {
    const reviewConfig = config.review?.parallelReviews || { enabled: false };

    if (!reviewConfig.enabled) {
      // Fallback to single review if somehow called without being enabled
      const prompt = this.buildReviewPrompt(context, config);
      return await this.runSingleReviewWithTemp(prompt, config, config.claude.temperature || 0, 1);
    }

    const temperatures = reviewConfig.temperatures || [0.3, 0.5];
    const prompt = this.buildReviewPrompt(context, config);

    console.log(`🔀 Running ${temperatures.length} parallel reviews...`);

    // Run reviews in parallel
    const reviewPromises = temperatures.map((temp, index) =>
      this.runSingleReviewWithTemp(prompt, config, temp, index + 1)
        .catch(error => {
          console.error(`  Review #${index + 1} failed: ${error.message}`);
          return null; // Return null for failed reviews
        })
    );

    const reviews = await Promise.all(reviewPromises);

    // Filter out failed reviews
    const successfulReviews = reviews.filter(r => r !== null && !r.error);

    if (successfulReviews.length === 0) {
      // All reviews failed
      return {
        error: 'All parallel reviews failed',
        decision: 'error',
        comments: [],
        summary: 'Failed to complete any reviews'
      };
    }

    if (successfulReviews.length === 1) {
      // Only one review succeeded, return it
      console.log('  Only one review succeeded, returning single result');
      return successfulReviews[0];
    }

    console.log(`🔗 Synthesizing ${successfulReviews.length} reviews...`);

    // Synthesize results (pass full config, not just reviewConfig)
    return await this.synthesizeReviews(successfulReviews, config);
  }

  /**
   * Run a single review with specific temperature
   * @param {string} prompt - Review prompt
   * @param {Object} config - Configuration
   * @param {number} temperature - Temperature parameter
   * @param {number} reviewNumber - Review identifier
   * @returns {Promise<Object>} Review result
   */
  async runSingleReviewWithTemp(prompt, config, temperature, reviewNumber) {
    console.log(`  Review #${reviewNumber} (temp=${temperature})...`);

    try {
      const response = await retryWithBackoff(
        async () => this.anthropic.messages.create({
          model: config.claude.model,
          max_tokens: config.claude.maxTokens,
          temperature: temperature,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ]
        }),
        {
          maxRetries: 3,
          initialDelay: 2000,
          shouldRetry: isRetryableError,
          onRetry: (error, attempt, delay) => {
            console.log(`  Retrying Review #${reviewNumber} (attempt ${attempt}/3) after ${delay}ms: ${error.message || error.status}`);
          }
        }
      );

      const reviewText = response.content[0].text;
      const review = this.parseReviewResponse(reviewText);

      // Tag with review metadata for debugging
      review._reviewNumber = reviewNumber;
      review._temperature = temperature;

      return review;

    } catch (error) {
      console.error(`  Review #${reviewNumber} error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Merge multiple reviews using Claude SDK (MECE principle)
   * @param {Array<Object>} reviews - Array of review results
   * @param {Object} config - Configuration
   * @returns {Promise<Object>} MECE merged review
   */
  async mergeReviewsWithClaude(reviews, config) {
    if (reviews.length === 0) {
      throw new Error('No reviews to merge');
    }

    if (reviews.length === 1) {
      return reviews[0];
    }

    const prompt = `You are a code review synthesizer applying MECE (Mutually Exclusive, Collectively Exhaustive) principles.

You have ${reviews.length} code reviews of the same pull request from parallel analyses:

${reviews.map((r, i) => `
**Review ${i + 1}** (temperature=${r._temperature || 'unknown'}):
- Decision: ${r.decision}
- Issues: ${r.comments?.length || 0} total
- Comments:
${JSON.stringify(r.comments || [], null, 2)}
`).join('\n')}

## Task: Create ONE MECE merged review

Apply MECE principles:
1. **Mutually Exclusive**: Merge duplicate issues into one
   - Same file + same line = definitely duplicate
   - Same file + similar line (±3) + same problem = likely duplicate
   - Same semantic issue (e.g., "missing validation" in different words) = duplicate

2. **Collectively Exhaustive**: Include ALL unique issues
   - Don't discard any unique finding
   - Preserve different perspectives on same code if they raise distinct concerns

3. **Quality merging**:
   - Use the clearest explanation for duplicates
   - Combine suggestions if both add value
   - Keep highest severity when merging
   - Preserve resources/links from either review

## Output Format (strict JSON):

{
  "summary": "Comprehensive summary mentioning all unique issue categories",
  "decision": "approved|needs_work|changes_requested (most conservative)",
  "comments": [
    {
      "file": "exact/path/to/file.js",
      "line": 42,
      "severity": "critical|major|minor",
      "message": "Clear explanation of the issue",
      "why": "Why this matters (from clearest review)",
      "suggestion": "How to fix (merged from both if valuable)",
      "resources": "Learning link"
    }
  ],
  "issues": {
    "critical": 0,
    "major": 0,
    "minor": 0
  }
}

Return ONLY the JSON object, no explanations.`;

    console.log('  Calling Claude SDK for MECE merge...');

    try {
      const response = await retryWithBackoff(
        async () => this.anthropic.messages.create({
          model: config.claude.model,
          max_tokens: config.claude.maxTokens || 8192,
          temperature: 0, // Deterministic merging
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ]
        }),
        {
          maxRetries: 3,
          initialDelay: 2000,
          shouldRetry: isRetryableError,
          onRetry: (error, attempt, delay) => {
            console.log(`  Retrying MECE merge (attempt ${attempt}/3) after ${delay}ms`);
          }
        }
      );

      const mergedText = response.content[0].text;
      const merged = this.parseReviewResponse(mergedText);

      // Log merge stats
      const inputComments = reviews.reduce((sum, r) => sum + (r.comments?.length || 0), 0);
      const outputComments = merged.comments?.length || 0;
      console.log(`  MECE merge: ${inputComments} input comments → ${outputComments} unique`);

      return merged;

    } catch (error) {
      console.error('Claude MECE merge failed:', error.message);
      console.log('  Falling back to first review');
      return reviews[0];
    }
  }

  /**
   * Synthesize multiple reviews using Claude SDK MECE merge
   * @param {Array<Object>} reviews - Array of review results
   * @param {Object} config - Parallel review configuration
   * @returns {Promise<Object>} Merged review
   */
  async synthesizeReviews(reviews, config) {
    console.log(`  Using Claude SDK MECE merge`);
    return await this.mergeReviewsWithClaude(reviews, config);
  }

  /**
   * Get severity weight for comparison
   * @param {string} severity - Severity level
   * @returns {number} Numeric weight
   */
  getSeverityWeight(severity) {
    const weights = {
      critical: 3,
      major: 2,
      minor: 1
    };
    return weights[severity] || 0;
  }

  /**
   * Aggregate decisions from multiple reviews (most conservative)
   * @param {Array<string>} decisions - Array of decision strings
   * @returns {string} Aggregated decision
   */
  aggregateDecision(decisions) {
    // Priority order (most conservative first)
    const priorityOrder = ['changes_requested', 'needs_work', 'approved', 'error'];

    for (const priority of priorityOrder) {
      if (decisions.includes(priority)) {
        return priority;
      }
    }

    return 'needs_work'; // Default fallback
  }

  /**
   * Combine summaries from multiple reviews
   * @param {Array<Object>} reviews - Array of reviews
   * @param {string} strategy - Synthesis strategy used
   * @param {number} uniqueCount - Number of unique issues
   * @returns {string} Combined summary
   */
  combineSummaries(reviews, strategy = 'union', uniqueCount = 0) {
    const individualCounts = reviews.map((r, i) =>
      `Review #${i + 1} (temp=${r._temperature || 'unknown'}): ${r.comments?.length || 0} issues`
    ).join(', ');

    const strategyDesc = {
      union: 'comprehensive',
      intersection: 'high-confidence',
      weighted: 'balanced'
    }[strategy] || strategy;

    return `Synthesized ${strategyDesc} review from ${reviews.length} parallel analyses. ` +
           `${individualCounts}. ` +
           `Total unique issues: ${uniqueCount}`;
  }

  /**
   * Count issues by severity
   * @param {Array<Object>} comments - Array of comments
   * @returns {Object} Issue counts by severity
   */
  countIssues(comments) {
    const issues = {
      critical: 0,
      major: 0,
      minor: 0
    };

    for (const comment of comments) {
      const severity = comment.severity || 'minor';
      issues[severity] = (issues[severity] || 0) + 1;
    }

    return issues;
  }

  /**
   * Get the higher severity between two
   * @param {string} s1 - First severity
   * @param {string} s2 - Second severity
   * @returns {string} Higher severity
   */
  getHigherSeverity(s1, s2) {
    const w1 = this.getSeverityWeight(s1);
    const w2 = this.getSeverityWeight(s2);
    return w1 >= w2 ? s1 : s2;
  }

  /**
   * Reduce severity by one level
   * @param {string} severity - Original severity
   * @returns {string} Reduced severity
   */
  reduceSeverity(severity) {
    const reductions = {
      critical: 'major',
      major: 'minor',
      minor: 'minor'
    };
    return reductions[severity] || severity;
  }

  /**
   * Merge suggestions from a group of comments
   * @param {Array<Object>} group - Group of similar comments
   * @returns {string|undefined} Merged suggestions
   */
  mergeSuggestions(group) {
    const suggestions = group
      .map(c => c.suggestion)
      .filter(s => s && s.trim());

    if (suggestions.length === 0) return undefined;
    if (suggestions.length === 1) return suggestions[0];

    // Remove duplicates and join with alternative markers
    const unique = [...new Set(suggestions)];
    if (unique.length === 1) return unique[0];

    return unique[0] + '\n\n**Alternative approaches:**\n' +
           unique.slice(1).map(s => '- ' + s).join('\n');
  }

  /**
   * Build review prompt for Claude
   * @param {Object} context - PR context
   * @param {Object} config - Configuration
   * @returns {string} Review prompt
   */
  buildReviewPrompt(context, config) {
    const { pr, diff, files, stats, coverage } = context;

    let prompt = `Please review the following pull request and provide detailed feedback.

PR Title: ${pr.title || 'Untitled'}
PR Description: ${pr.description || 'No description provided'}
Platform: ${pr.platform}

Statistics:
- Files Changed: ${stats?.filesChanged || 0}
- Lines Added: ${stats?.additions || 0}
- Lines Deleted: ${stats?.deletions || 0}
`;

    if (coverage) {
      prompt += `\nTest Coverage: ${coverage.percentage}% (Required: ${config.review?.minCoveragePercent || 80}%)`;
      if (coverage.missing?.length > 0) {
        prompt += `\nUncovered files: ${coverage.missing.join(', ')}`;
      }
    }

    prompt += '\n\n## Changed Files:\n';

    // Add file list
    if (files && files.length > 0) {
      files.forEach(file => {
        prompt += `- ${file.path} (${file.type})\n`;
      });
    }

    prompt += '\n## Diff:\n';

    // Add diff content
    if (diff && diff.length > 0) {
      diff.forEach(file => {
        prompt += `\n### ${file.new_path || file.old_path}\n`;
        prompt += '```diff\n';
        prompt += file.diff || 'No diff available';
        prompt += '\n```\n';
      });
    }

    // Append the review prompt template loaded from file
    // Replace template variable with actual config value
    const minCoveragePercent = config.review?.minCoveragePercent || 80;
    const promptTemplate = this.getPromptTemplate();
    const promptWithConfig = promptTemplate.replace(
      /\$\{config\.review\?\.minCoveragePercent \|\| 80\}/g,
      minCoveragePercent.toString()
    );
    prompt += '\n' + promptWithConfig;

    return prompt;
  }

  /**
   * Parse Claude's review response
   * @param {string} response - Claude's response text
   * @returns {Object} Parsed review
   */
  parseReviewResponse(response) {
    // Try to parse as JSON first
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      // Fall back to text parsing
      console.log('Falling back to text parsing');
    }

    // Fallback text parsing
    const review = {
      summary: '',
      decision: 'needs_work',
      comments: [],
      issues: {
        critical: 0,
        major: 0,
        minor: 0
      }
    };

    // Extract summary
    const summaryMatch = response.match(/(?:summary|review|overall)[:\s]+([^\n]+)/i);
    if (summaryMatch) {
      review.summary = summaryMatch[1].trim();
    } else {
      review.summary = response.split('\n')[0].trim();
    }

    // Determine decision based on keywords
    const lowerResponse = response.toLowerCase();
    if (lowerResponse.includes('approve') && !lowerResponse.includes('not approve')) {
      review.decision = 'approved';
    } else if (lowerResponse.includes('critical') || lowerResponse.includes('must fix')) {
      review.decision = 'changes_requested';
    } else if (lowerResponse.includes('needs work') || lowerResponse.includes('should fix')) {
      review.decision = 'needs_work';
    }

    // Extract comments from bullet points or numbered lists
    const commentPatterns = [
      /[-•]\s*(?:Line\s+(\d+)\s+in\s+([^:]+):\s*)?(.+)/gi,
      /\d+\.\s*(?:Line\s+(\d+)\s+in\s+([^:]+):\s*)?(.+)/gi
    ];

    for (const pattern of commentPatterns) {
      let match;
      while ((match = pattern.exec(response)) !== null) {
        const comment = {
          message: match[3] || match[0],
          severity: 'minor'
        };

        if (match[1]) comment.line = parseInt(match[1]);
        if (match[2]) comment.file = match[2].trim();

        // Determine severity from message
        const message = comment.message.toLowerCase();
        if (message.includes('critical') || message.includes('security')) {
          comment.severity = 'critical';
          review.issues.critical++;
        } else if (message.includes('should') || message.includes('important')) {
          comment.severity = 'major';
          review.issues.major++;
        } else {
          review.issues.minor++;
        }

        review.comments.push(comment);
      }
    }

    return review;
  }
}

export default Review;