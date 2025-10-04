/**
 * FindingAggregator - Aggregates and deduplicates findings from sub-agents
 * Implements MECE (Mutually Exclusive, Collectively Exhaustive) principle
 * Detects conflicts and prioritizes findings by severity
 */

class FindingAggregator {
  constructor() {
    this.severityOrder = { critical: 0, major: 1, minor: 2 };
  }

  /**
   * Aggregate findings from all agent categories
   * @param {Object} state - The review state containing findings
   * @returns {Object} Aggregated findings with conflicts and total count
   */
  aggregate(state) {
    // Collect all findings and add source_agent field
    const allFindings = this.collectFindings(state.findings);

    // Deduplicate using MECE principle
    const deduplicated = this.deduplicateFindings(allFindings);

    // Detect conflicts (different severities for same location)
    const conflicts = this.detectConflicts(allFindings);

    // Prioritize by severity
    const prioritized = this.prioritizeFindings(deduplicated);

    return {
      aggregated: prioritized,
      conflicts,
      total: prioritized.length
    };
  }

  /**
   * Collect findings from all categories and add source_agent
   * @private
   */
  collectFindings(findings) {
    const collected = [];

    for (const [category, items] of Object.entries(findings)) {
      for (const finding of items) {
        collected.push({
          ...finding,
          source_agent: finding.source_agent || category
        });
      }
    }

    return collected;
  }

  /**
   * Deduplicate findings using MECE principle
   * @param {Array} findings - Array of findings to deduplicate
   * @returns {Array} Deduplicated findings with merged sources
   */
  deduplicateFindings(findings) {
    const fingerprints = new Map();
    let unknownCounter = 0;

    for (const finding of findings) {
      const fingerprint = this.createFingerprint(finding);
      // Generate unique source for findings without source_agent
      const sourceAgent = finding.source_agent || `unknown_${++unknownCounter}`;

      if (fingerprints.has(fingerprint)) {
        // Merge with existing finding
        const existing = fingerprints.get(fingerprint);
        existing.sources = existing.sources || [existing.source_agent || `unknown_${unknownCounter}`];

        if (!existing.sources.includes(sourceAgent)) {
          existing.sources.push(sourceAgent);
        }

        // Escalate severity if multiple agents report same issue
        if (existing.sources.length >= 3 && existing.severity === 'minor') {
          existing.severity = 'major';
          existing.escalated = true;
        }
      } else {
        // New finding
        fingerprints.set(fingerprint, {
          ...finding,
          sources: [sourceAgent]
        });
      }
    }

    return Array.from(fingerprints.values());
  }

  /**
   * Create fingerprint for finding deduplication
   * @private
   */
  createFingerprint(finding) {
    return `${finding.file}:${finding.line}:${finding.category}`;
  }

  /**
   * Detect conflicts where same location has different severities
   * @param {Array} findings - Array of findings to check for conflicts
   * @returns {Array} Array of conflict objects
   */
  detectConflicts(findings) {
    const grouped = this.groupByLocation(findings);
    const conflicts = [];

    for (const [location, items] of Object.entries(grouped)) {
      const severities = [...new Set(items.map(f => f.severity))];

      if (severities.length > 1) {
        conflicts.push({
          location,
          severities,
          findings: items.map(f => ({
            source: f.source_agent,
            severity: f.severity,
            category: f.category
          }))
        });
      }
    }

    return conflicts;
  }

  /**
   * Sort findings by severity priority
   * @param {Array} findings - Array of findings to prioritize
   * @returns {Array} Sorted findings (critical > major > minor)
   */
  prioritizeFindings(findings) {
    return [...findings].sort((a, b) => {
      return this.severityOrder[a.severity] - this.severityOrder[b.severity];
    });
  }

  /**
   * Group findings by location (file:line)
   * @param {Array} findings - Array of findings to group
   * @returns {Object} Findings grouped by location
   */
  groupByLocation(findings) {
    const grouped = {};

    for (const finding of findings) {
      const location = `${finding.file}:${finding.line}`;

      if (!grouped[location]) {
        grouped[location] = [];
      }

      grouped[location].push(finding);
    }

    return grouped;
  }

  /**
   * Compare severity levels
   * @param {String} sev1 - First severity
   * @param {String} sev2 - Second severity
   * @returns {Boolean} True if sev1 is higher than sev2
   */
  isSeverityHigher(sev1, sev2) {
    return this.severityOrder[sev1] < this.severityOrder[sev2];
  }
}

export default FindingAggregator;