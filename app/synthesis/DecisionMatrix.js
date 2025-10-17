/**
 * DecisionMatrix - Makes review decisions based on findings and metrics
 * Implements configurable rules for determining review outcomes
 */

class DecisionMatrix {
  constructor(rules = null) {
    this.rules = rules || DecisionMatrix.getDefaultRules();
  }

  /**
   * Get default decision rules
   * @returns {Object} Default rule thresholds
   */
  static getDefaultRules() {
    return {
      critical_threshold: 0,        // Any critical issue triggers changes_requested
      major_threshold: 3,           // More than 3 major issues triggers needs_work
      minor_threshold: 10,          // More than 10 minor issues triggers review
      coverage_delta_threshold: -5  // Coverage drop > 5% triggers needs_work
    };
  }

  /**
   * Make review decision based on findings and metrics
   * @param {Array} findings - Aggregated findings
   * @param {Object} metrics - Review metrics (coverage_delta, etc.)
   * @returns {Object} Decision with rationale and metadata
   */
  decide(findings, metrics = {}) {
    const counts = this.countBySeverity(findings);
    const coverageDelta = metrics.coverage_delta || 0;

    // Build decision object with metadata
    const decision = {
      critical_count: counts.critical,
      major_count: counts.major,
      minor_count: counts.minor,
      total_findings: findings.length,
      coverage_delta: coverageDelta
    };

    // Rule 1: Any critical issues → changes_requested
    if (counts.critical > this.rules.critical_threshold) {
      return {
        ...decision,
        decision: 'changes_requested',
        rationale: `Found ${counts.critical} critical issue(s) that must be addressed`
      };
    }

    // Rule 2: Too many major issues → needs_work
    if (counts.major > this.rules.major_threshold) {
      return {
        ...decision,
        decision: 'needs_work',
        rationale: `Found ${counts.major} major issues exceeding threshold of ${this.rules.major_threshold}`
      };
    }

    // Rule 3: Coverage delta check → needs_work
    if (coverageDelta < this.rules.coverage_delta_threshold) {
      return {
        ...decision,
        decision: 'needs_work',
        rationale: `Test coverage decreased by ${Math.abs(coverageDelta)}%, exceeding threshold of ${Math.abs(this.rules.coverage_delta_threshold)}%`
      };
    }

    // Rule 4: Only minor issues → approved_with_comments
    if (counts.minor > 0 && counts.major === 0 && counts.critical === 0) {
      return {
        ...decision,
        decision: 'approved_with_comments',
        rationale: `Approved with ${counts.minor} minor suggestion(s) for improvement`
      };
    }

    // Rule 5: No issues → approved
    if (findings.length === 0) {
      return {
        ...decision,
        decision: 'approved',
        rationale: 'No issues found - code meets all quality standards'
      };
    }

    // Default case: approved_with_comments for mixed findings
    return {
      ...decision,
      decision: 'approved_with_comments',
      rationale: `Found ${counts.major} major and ${counts.minor} minor issues within acceptable thresholds`
    };
  }

  /**
   * Count findings by severity level
   * @param {Array} findings - Array of findings to count
   * @returns {Object} Counts by severity
   */
  countBySeverity(findings) {
    const counts = {
      critical: 0,
      major: 0,
      minor: 0
    };

    for (const finding of findings) {
      const severity = finding.severity?.toLowerCase();
      if (severity in counts) {
        counts[severity]++;
      }
    }

    return counts;
  }
}

export default DecisionMatrix;