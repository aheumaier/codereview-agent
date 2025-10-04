/**
 * Test suite for Synthesis Layer components
 * Tests FindingAggregator and DecisionMatrix functionality
 */

import FindingAggregator from '../../app/synthesis/FindingAggregator';
import DecisionMatrix from '../../app/synthesis/DecisionMatrix';

describe('Synthesis Layer', () => {
  describe('FindingAggregator', () => {
    let aggregator;

    beforeEach(() => {
      aggregator = new FindingAggregator();
    });

    describe('aggregate()', () => {
      it('should aggregate findings from all agent categories', () => {
        const state = {
          findings: {
            test: [
              { file: 'src/app.js', line: 10, severity: 'major', category: 'test_coverage', message: 'Missing tests' }
            ],
            security: [
              { file: 'src/auth.js', line: 20, severity: 'critical', category: 'security', message: 'SQL injection risk' }
            ],
            performance: [
              { file: 'src/db.js', line: 30, severity: 'minor', category: 'performance', message: 'Unoptimized query' }
            ],
            architecture: [
              { file: 'src/service.js', line: 40, severity: 'major', category: 'architecture', message: 'SOLID violation' }
            ]
          }
        };

        const result = aggregator.aggregate(state);

        expect(result.aggregated).toHaveLength(4);
        expect(result.aggregated[0]).toHaveProperty('source_agent');
        expect(result.total).toBe(4);
        expect(result.conflicts).toEqual([]);

        // Verify severity prioritization (critical first)
        expect(result.aggregated[0].severity).toBe('critical');
      });

      it('should deduplicate identical findings using MECE principle', () => {
        const state = {
          findings: {
            test: [
              { file: 'src/app.js', line: 10, severity: 'major', category: 'test_coverage', message: 'Missing tests' }
            ],
            security: [
              { file: 'src/app.js', line: 10, severity: 'major', category: 'test_coverage', message: 'Missing tests' }
            ],
            performance: [],
            architecture: []
          }
        };

        const result = aggregator.aggregate(state);

        expect(result.aggregated).toHaveLength(1);
        expect(result.aggregated[0].sources).toEqual(['test', 'security']);
        expect(result.total).toBe(1);
      });

      it('should escalate severity when multiple agents report same issue', () => {
        const state = {
          findings: {
            test: [
              { file: 'src/app.js', line: 10, severity: 'minor', category: 'quality', message: 'Code quality issue' }
            ],
            security: [
              { file: 'src/app.js', line: 10, severity: 'minor', category: 'quality', message: 'Code quality issue' }
            ],
            performance: [
              { file: 'src/app.js', line: 10, severity: 'minor', category: 'quality', message: 'Code quality issue' }
            ],
            architecture: []
          }
        };

        const result = aggregator.aggregate(state);

        expect(result.aggregated).toHaveLength(1);
        expect(result.aggregated[0].severity).toBe('major'); // Escalated from minor
        expect(result.aggregated[0].sources).toHaveLength(3);
      });

      it('should detect conflicts when different severities for same location', () => {
        const state = {
          findings: {
            test: [
              { file: 'src/app.js', line: 10, severity: 'critical', category: 'test', message: 'Critical test issue' }
            ],
            security: [
              { file: 'src/app.js', line: 10, severity: 'minor', category: 'security', message: 'Minor security issue' }
            ],
            performance: [],
            architecture: []
          }
        };

        const result = aggregator.aggregate(state);

        expect(result.conflicts).toHaveLength(1);
        expect(result.conflicts[0]).toMatchObject({
          location: 'src/app.js:10',
          severities: expect.arrayContaining(['critical', 'minor'])
        });
      });
    });

    describe('deduplicateFindings()', () => {
      it('should create correct fingerprint for deduplication', () => {
        const findings = [
          { file: 'src/app.js', line: 10, category: 'test', severity: 'major', message: 'Test 1' },
          { file: 'src/app.js', line: 10, category: 'test', severity: 'major', message: 'Test 2' },
          { file: 'src/app.js', line: 20, category: 'test', severity: 'major', message: 'Test 3' }
        ];

        const result = aggregator.deduplicateFindings(findings);

        expect(result).toHaveLength(2);
        expect(result[0].sources).toHaveLength(2);
        expect(result[1].sources).toHaveLength(1);
      });

      it('should merge findings with same fingerprint', () => {
        const findings = [
          { file: 'src/app.js', line: 10, category: 'test', severity: 'minor', message: 'Issue A', source_agent: 'test' },
          { file: 'src/app.js', line: 10, category: 'test', severity: 'minor', message: 'Issue B', source_agent: 'security' }
        ];

        const result = aggregator.deduplicateFindings(findings);

        expect(result).toHaveLength(1);
        expect(result[0].sources).toEqual(['test', 'security']);
        expect(result[0].message).toContain('Issue');
      });
    });

    describe('detectConflicts()', () => {
      it('should identify different severity levels for same location', () => {
        const findings = [
          { file: 'src/app.js', line: 10, severity: 'critical', category: 'security', source_agent: 'security' },
          { file: 'src/app.js', line: 10, severity: 'minor', category: 'test', source_agent: 'test' }
        ];

        const conflicts = aggregator.detectConflicts(findings);

        expect(conflicts).toHaveLength(1);
        expect(conflicts[0].location).toBe('src/app.js:10');
        expect(conflicts[0].severities).toContain('critical');
        expect(conflicts[0].severities).toContain('minor');
      });

      it('should not flag same severity as conflict', () => {
        const findings = [
          { file: 'src/app.js', line: 10, severity: 'major', category: 'security', source_agent: 'security' },
          { file: 'src/app.js', line: 10, severity: 'major', category: 'test', source_agent: 'test' }
        ];

        const conflicts = aggregator.detectConflicts(findings);

        expect(conflicts).toHaveLength(0);
      });
    });

    describe('prioritizeFindings()', () => {
      it('should sort findings by severity (critical > major > minor)', () => {
        const findings = [
          { severity: 'minor', message: 'Minor issue' },
          { severity: 'critical', message: 'Critical issue' },
          { severity: 'major', message: 'Major issue' },
          { severity: 'minor', message: 'Another minor' }
        ];

        const sorted = aggregator.prioritizeFindings(findings);

        expect(sorted[0].severity).toBe('critical');
        expect(sorted[1].severity).toBe('major');
        expect(sorted[2].severity).toBe('minor');
        expect(sorted[3].severity).toBe('minor');
      });
    });

    describe('groupByLocation()', () => {
      it('should group findings by file:line', () => {
        const findings = [
          { file: 'src/app.js', line: 10, message: 'Issue 1' },
          { file: 'src/app.js', line: 10, message: 'Issue 2' },
          { file: 'src/app.js', line: 20, message: 'Issue 3' },
          { file: 'src/auth.js', line: 10, message: 'Issue 4' }
        ];

        const grouped = aggregator.groupByLocation(findings);

        expect(Object.keys(grouped)).toHaveLength(3);
        expect(grouped['src/app.js:10']).toHaveLength(2);
        expect(grouped['src/app.js:20']).toHaveLength(1);
        expect(grouped['src/auth.js:10']).toHaveLength(1);
      });
    });

    describe('isSeverityHigher()', () => {
      it('should correctly compare severity levels', () => {
        expect(aggregator.isSeverityHigher('critical', 'major')).toBe(true);
        expect(aggregator.isSeverityHigher('critical', 'minor')).toBe(true);
        expect(aggregator.isSeverityHigher('major', 'minor')).toBe(true);
        expect(aggregator.isSeverityHigher('minor', 'major')).toBe(false);
        expect(aggregator.isSeverityHigher('minor', 'critical')).toBe(false);
        expect(aggregator.isSeverityHigher('major', 'critical')).toBe(false);
        expect(aggregator.isSeverityHigher('major', 'major')).toBe(false);
      });
    });
  });

  describe('DecisionMatrix', () => {
    let matrix;

    beforeEach(() => {
      matrix = new DecisionMatrix();
    });

    describe('constructor', () => {
      it('should use default rules if none provided', () => {
        const defaultMatrix = new DecisionMatrix();
        const rules = defaultMatrix.rules;

        expect(rules.critical_threshold).toBe(0);
        expect(rules.major_threshold).toBe(3);
        expect(rules.minor_threshold).toBe(10);
        expect(rules.coverage_delta_threshold).toBe(-5);
      });

      it('should accept custom rules', () => {
        const customRules = {
          critical_threshold: 1,
          major_threshold: 5,
          minor_threshold: 20,
          coverage_delta_threshold: -10
        };

        const customMatrix = new DecisionMatrix(customRules);

        expect(customMatrix.rules).toEqual(customRules);
      });
    });

    describe('decide()', () => {
      it('should return changes_requested for any critical issues', () => {
        const findings = [
          { severity: 'critical', message: 'Critical security issue' },
          { severity: 'minor', message: 'Minor style issue' }
        ];
        const metrics = { coverage_delta: 5 };

        const decision = matrix.decide(findings, metrics);

        expect(decision.decision).toBe('changes_requested');
        expect(decision.rationale).toContain('critical');
      });

      it('should return needs_work for too many major issues', () => {
        const findings = [
          { severity: 'major', message: 'Major 1' },
          { severity: 'major', message: 'Major 2' },
          { severity: 'major', message: 'Major 3' },
          { severity: 'major', message: 'Major 4' }
        ];
        const metrics = { coverage_delta: 0 };

        const decision = matrix.decide(findings, metrics);

        expect(decision.decision).toBe('needs_work');
        expect(decision.rationale).toContain('major issues');
      });

      it('should return needs_work for coverage delta below threshold', () => {
        const findings = [
          { severity: 'minor', message: 'Minor issue' }
        ];
        const metrics = { coverage_delta: -6 };

        const decision = matrix.decide(findings, metrics);

        expect(decision.decision).toBe('needs_work');
        expect(decision.rationale).toContain('coverage');
      });

      it('should return approved_with_comments for only minor issues', () => {
        const findings = [
          { severity: 'minor', message: 'Minor 1' },
          { severity: 'minor', message: 'Minor 2' }
        ];
        const metrics = { coverage_delta: 0 };

        const decision = matrix.decide(findings, metrics);

        expect(decision.decision).toBe('approved_with_comments');
        expect(decision.rationale).toContain('minor');
      });

      it('should return approved for no issues', () => {
        const findings = [];
        const metrics = { coverage_delta: 5 };

        const decision = matrix.decide(findings, metrics);

        expect(decision.decision).toBe('approved');
        expect(decision.rationale).toContain('No issues');
      });

      it('should include metadata in decision', () => {
        const findings = [
          { severity: 'major', message: 'Major issue' },
          { severity: 'minor', message: 'Minor issue' }
        ];
        const metrics = { coverage_delta: 2 };

        const decision = matrix.decide(findings, metrics);

        expect(decision).toHaveProperty('critical_count', 0);
        expect(decision).toHaveProperty('major_count', 1);
        expect(decision).toHaveProperty('minor_count', 1);
        expect(decision).toHaveProperty('total_findings', 2);
        expect(decision).toHaveProperty('coverage_delta', 2);
      });
    });

    describe('countBySeverity()', () => {
      it('should correctly count findings by severity', () => {
        const findings = [
          { severity: 'critical' },
          { severity: 'major' },
          { severity: 'major' },
          { severity: 'minor' },
          { severity: 'minor' },
          { severity: 'minor' }
        ];

        const counts = matrix.countBySeverity(findings);

        expect(counts).toEqual({
          critical: 1,
          major: 2,
          minor: 3
        });
      });

      it('should return zero counts for missing severities', () => {
        const findings = [
          { severity: 'minor' }
        ];

        const counts = matrix.countBySeverity(findings);

        expect(counts).toEqual({
          critical: 0,
          major: 0,
          minor: 1
        });
      });
    });

    describe('getDefaultRules()', () => {
      it('should return default rule thresholds', () => {
        const rules = DecisionMatrix.getDefaultRules();

        expect(rules).toEqual({
          critical_threshold: 0,
          major_threshold: 3,
          minor_threshold: 10,
          coverage_delta_threshold: -5
        });
      });
    });
  });

  describe('Integration', () => {
    it('should work together for complete synthesis flow', () => {
      const aggregator = new FindingAggregator();
      const matrix = new DecisionMatrix();

      const state = {
        findings: {
          test: [
            { file: 'src/app.js', line: 10, severity: 'major', category: 'test_coverage', message: 'Missing tests' }
          ],
          security: [
            { file: 'src/auth.js', line: 20, severity: 'critical', category: 'security', message: 'SQL injection' }
          ],
          performance: [],
          architecture: []
        }
      };

      const aggregated = aggregator.aggregate(state);
      const metrics = { coverage_delta: 0 };
      const decision = matrix.decide(aggregated.aggregated, metrics);

      expect(aggregated.total).toBe(2);
      expect(decision.decision).toBe('changes_requested');
      expect(decision.rationale).toContain('critical');
    });
  });
});