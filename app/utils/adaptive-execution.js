/**
 * Adaptive Execution Strategy
 * Selects sequential vs parallel vs batch mode based on PR characteristics
 */

/**
 * Execution modes for PR review
 */
export const ExecutionMode = {
  SEQUENTIAL: 'SEQUENTIAL',
  PARALLEL: 'PARALLEL',
  INCREMENTAL_BATCH: 'INCREMENTAL_BATCH',
  REJECT_TOO_LARGE: 'REJECT_TOO_LARGE'
};

/**
 * Analyzes PR characteristics and selects optimal execution strategy
 */
export class AdaptiveExecutionStrategy {
  /**
   * Initialize with optional configuration
   * @param {Object} config - Configuration overrides
   */
  constructor(config = {}) {
    this.thresholds = {
      smallFiles: config.smallFiles || 10,
      smallLOC: config.smallLOC || 500,
      mediumFiles: config.mediumFiles || 30,
      mediumLOC: config.mediumLOC || 2000,
      largeFiles: config.largeFiles || 100,
      largeLOC: config.largeLOC || 5000,
      complexityThreshold: config.complexityThreshold || 0.7,
      defaultBatchSize: config.defaultBatchSize || 10,
      ...config.thresholds
    };
  }

  /**
   * Select execution strategy for PR
   * @param {Object} pr - Pull request object with files array
   * @returns {Object} Strategy decision with mode, reason, and parameters
   */
  selectStrategy(pr) {
    if (!pr) {
      throw new Error('PR object is required');
    }

    // Extract PR metrics
    const metrics = this.extractMetrics(pr);
    const complexity = this.calculateComplexity(pr, metrics);

    console.log(`[AdaptiveExecution] PR Analysis: ${metrics.fileCount} files, ${metrics.totalLOC} LOC, complexity: ${complexity.toFixed(2)}`);

    // Apply decision tree based on research findings
    const decision = this.applyDecisionTree(metrics, complexity);

    // Log decision
    console.log(`[AdaptiveExecution] Selected: ${decision.mode} - ${decision.reason}`);

    return decision;
  }

  /**
   * Extract metrics from PR
   * @param {Object} pr - Pull request
   * @returns {Object} Extracted metrics
   */
  extractMetrics(pr) {
    const files = pr.files || [];
    const fileCount = files.length;

    const totalLOC = files.reduce((sum, file) => {
      const additions = file.additions || 0;
      const deletions = file.deletions || 0;
      return sum + additions + deletions;
    }, 0);

    const largestFile = Math.max(...files.map(f =>
      (f.additions || 0) + (f.deletions || 0)
    ), 0);

    const testFileCount = files.filter(f =>
      /test|spec|\.test\.|\.spec\./i.test(f.path || f.filename || '')
    ).length;

    return {
      fileCount,
      totalLOC,
      largestFile,
      testFileCount,
      testCoverage: fileCount > 0 ? testFileCount / fileCount : 0
    };
  }

  /**
   * Apply decision tree to select execution mode
   * @param {Object} metrics - PR metrics
   * @param {number} complexity - Complexity score
   * @returns {Object} Decision with mode and reason
   */
  applyDecisionTree(metrics, complexity) {
    const { fileCount, totalLOC } = metrics;

    // Small PR: Sequential for token efficiency
    if (fileCount <= this.thresholds.smallFiles && totalLOC < this.thresholds.smallLOC) {
      return {
        mode: ExecutionMode.SEQUENTIAL,
        reason: 'Small PR, token efficiency prioritized',
        metrics
      };
    }

    // Medium PR: Complexity-based decision
    if (fileCount <= this.thresholds.mediumFiles && totalLOC < this.thresholds.mediumLOC) {
      if (complexity > this.thresholds.complexityThreshold) {
        return {
          mode: ExecutionMode.PARALLEL,
          reason: `Medium PR with high complexity (${complexity.toFixed(2)})`,
          metrics,
          complexity
        };
      }
      return {
        mode: ExecutionMode.SEQUENTIAL,
        reason: `Medium PR with low complexity (${complexity.toFixed(2)})`,
        metrics,
        complexity
      };
    }

    // Large PR: Batch processing
    if (fileCount <= this.thresholds.largeFiles && totalLOC < this.thresholds.largeLOC) {
      const batchSize = this.calculateOptimalBatchSize(metrics);
      return {
        mode: ExecutionMode.INCREMENTAL_BATCH,
        reason: 'Large PR, prevent context overflow',
        batchSize,
        estimatedBatches: Math.ceil(fileCount / batchSize),
        metrics
      };
    }

    // Oversized PR: Reject
    return {
      mode: ExecutionMode.REJECT_TOO_LARGE,
      reason: `PR too large (${fileCount} files, ${totalLOC} LOC). Please split into smaller PRs.`,
      maxFiles: this.thresholds.largeFiles,
      maxLOC: this.thresholds.largeLOC,
      metrics
    };
  }

  /**
   * Calculate PR complexity score (0-1)
   * Based on security, architecture, breaking changes, test coverage
   * @param {Object} pr - Pull request
   * @param {Object} metrics - Extracted metrics
   * @returns {number} Complexity score between 0 and 1
   */
  calculateComplexity(pr, metrics) {
    let score = 0;
    const factors = [];

    // Security-sensitive files (+0.3)
    const securityPatterns = /auth|security|crypto|session|password|token|secret|key|certificate/i;
    const hasSecurityChanges = (pr.files || []).some(f =>
      securityPatterns.test(f.path || f.filename || '')
    );
    if (hasSecurityChanges) {
      score += 0.3;
      factors.push('security-sensitive');
    }

    // Architectural changes (+0.3)
    const archPatterns = /schema|migration|config|api|route|middleware|model|database|\.env/i;
    const hasArchChanges = (pr.files || []).some(f =>
      archPatterns.test(f.path || f.filename || '')
    );
    if (hasArchChanges) {
      score += 0.3;
      factors.push('architectural');
    }

    // Breaking changes detection (+0.4)
    const prText = `${pr.title || ''} ${pr.body || ''} ${pr.description || ''}`.toLowerCase();
    const breakingKeywords = ['breaking', 'breaking change', 'incompatible', 'deprecated', 'removal'];
    const hasBreakingChanges = breakingKeywords.some(keyword => prText.includes(keyword));
    if (hasBreakingChanges) {
      score += 0.4;
      factors.push('breaking-changes');
    }

    // Low test coverage (+0.2)
    if (metrics.testCoverage < 0.3) {
      score += 0.2;
      factors.push('low-test-coverage');
    }

    // Large file changes (+0.1)
    if (metrics.largestFile > 500) {
      score += 0.1;
      factors.push('large-file-changes');
    }

    // External dependencies (+0.2)
    const depPatterns = /package\.json|requirements\.txt|Gemfile|go\.mod|pom\.xml|build\.gradle/i;
    const hasDependencyChanges = (pr.files || []).some(f =>
      depPatterns.test(f.path || f.filename || '')
    );
    if (hasDependencyChanges) {
      score += 0.2;
      factors.push('dependency-changes');
    }

    const finalScore = Math.min(score, 1.0);

    if (factors.length > 0) {
      console.debug(`[AdaptiveExecution] Complexity factors: ${factors.join(', ')}`);
    }

    return finalScore;
  }

  /**
   * Calculate optimal batch size based on PR characteristics
   * @param {Object} metrics - PR metrics
   * @returns {number} Optimal batch size
   */
  calculateOptimalBatchSize(metrics) {
    const { fileCount, totalLOC } = metrics;

    // Adjust batch size based on average file size
    const avgLOCPerFile = totalLOC / Math.max(fileCount, 1);

    if (avgLOCPerFile > 200) {
      // Large files: smaller batches
      return Math.max(5, this.thresholds.defaultBatchSize / 2);
    } else if (avgLOCPerFile < 50) {
      // Small files: larger batches
      return Math.min(20, this.thresholds.defaultBatchSize * 1.5);
    }

    return this.thresholds.defaultBatchSize;
  }

  /**
   * Estimate token usage for PR
   * @param {Object} pr - Pull request
   * @returns {number} Estimated tokens
   */
  estimateTokenUsage(pr) {
    const metrics = this.extractMetrics(pr);
    const complexity = this.calculateComplexity(pr, metrics);

    // Base estimate: ~100 tokens per file + complexity multiplier
    let baseTokens = metrics.fileCount * 100;

    // Add tokens for LOC (roughly 1 token per 4 chars, assume 50 chars per line)
    baseTokens += (metrics.totalLOC * 50) / 4;

    // Complexity multiplier
    const complexityMultiplier = 1 + complexity;
    const estimate = Math.ceil(baseTokens * complexityMultiplier);

    console.debug(`[AdaptiveExecution] Estimated ${estimate} tokens for PR`);
    return estimate;
  }

  /**
   * Check if PR should be reviewed at all
   * @param {Object} pr - Pull request
   * @returns {Object} Validation result
   */
  validatePR(pr) {
    if (!pr) {
      return { valid: false, reason: 'PR object is null or undefined' };
    }

    if (!pr.files || pr.files.length === 0) {
      return { valid: false, reason: 'PR has no files' };
    }

    const metrics = this.extractMetrics(pr);

    if (metrics.totalLOC === 0) {
      return { valid: false, reason: 'PR has no code changes' };
    }

    // Check for auto-generated files only
    const allGenerated = pr.files.every(f => {
      const path = f.path || f.filename || '';
      return /package-lock\.json|yarn\.lock|\.min\.|dist\/|build\/|vendor\//i.test(path);
    });

    if (allGenerated) {
      return { valid: false, reason: 'PR contains only auto-generated files' };
    }

    return { valid: true, metrics };
  }
}

/**
 * Factory function for creating strategy instance
 * @param {Object} config - Configuration
 * @returns {AdaptiveExecutionStrategy} Strategy instance
 */
export function createAdaptiveStrategy(config = {}) {
  return new AdaptiveExecutionStrategy(config);
}

export default AdaptiveExecutionStrategy;