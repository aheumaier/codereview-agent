/**
 * Abstract base class for all review agents
 */
export default class BaseAgent {
  constructor(name, description) {
    this.name = name;
    this.description = description;
  }

  /**
   * Analyze code - must be implemented by subclass
   * @param {Object} context - Review context
   * @param {Object} rules - Agent-specific rules
   * @returns {Promise<Object>} Findings with metrics
   */
  async analyze(context, rules) {
    throw new Error(`analyze() must be implemented by ${this.name}`);
  }

  /**
   * Validate finding structure
   * @param {Object} finding - Finding to validate
   * @returns {boolean} True if valid
   */
  validateFinding(finding) {
    const required = ['file', 'severity', 'category', 'message'];

    for (const field of required) {
      if (!finding[field]) {
        throw new Error(`Finding missing required field: ${field}`);
      }
    }

    const validSeverities = ['critical', 'major', 'minor'];
    if (!validSeverities.includes(finding.severity)) {
      throw new Error(`Invalid severity: ${finding.severity}. Must be one of: ${validSeverities.join(', ')}`);
    }

    return true;
  }

  /**
   * Format output as structured JSON
   * @param {Array} findings - Findings array
   * @param {Object} metrics - Metrics object
   * @returns {Object} Formatted output
   */
  formatOutput(findings, metrics = {}) {
    // Validate all findings
    findings.forEach(f => this.validateFinding(f));

    return {
      agent: this.name,
      findings,
      metrics,
      timestamp: Date.now()
    };
  }
}