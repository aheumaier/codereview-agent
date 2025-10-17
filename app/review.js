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
   * Review a PR using Claude with sub-agent orchestration
   * @param {Object} context - PR context from context builder
   * @param {Object} config - Configuration
   * @returns {Promise<Object>} Review results
   */
  async reviewPR(context, config) {
    try {
      this.initializeClient(config.claude.apiKey);

      // Single review - sub-agent orchestration handles the analysis
      const prompt = this.buildReviewPrompt(context, config);
      return await this.runSingleReview(prompt, config);

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
   * Run a single review
   * @param {string} prompt - Review prompt
   * @param {Object} config - Configuration
   * @returns {Promise<Object>} Review result
   */
  async runSingleReview(prompt, config) {
    console.log(`  Running review analysis...`);

    try {
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
          initialDelay: 2000,
          shouldRetry: isRetryableError,
          onRetry: (error, attempt, delay) => {
            console.log(`  Retrying review (attempt ${attempt}/3) after ${delay}ms: ${error.message || error.status}`);
          }
        }
      );

      const reviewText = response.content[0].text;
      const review = this.parseReviewResponse(reviewText);

      return review;

    } catch (error) {
      console.error(`  Review error: ${error.message}`);
      throw error;
    }
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