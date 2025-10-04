import StateManager from '../../app/state/StateManager.js';
import ReviewState from '../../app/state/ReviewState.js';
import FeatureFlags from '../../app/utils/featureFlags.js';
import SubAgentOrchestrator from '../../app/agents/SubAgentOrchestrator.js';
import FindingAggregator from '../../app/synthesis/FindingAggregator.js';
import DecisionMatrix from '../../app/synthesis/DecisionMatrix.js';

describe('E2E: Sub-Agent Review Flow', () => {
  let stateManager;
  let orchestrator;
  let aggregator;
  let decisionMatrix;

  beforeEach(async () => {
    stateManager = new StateManager(':memory:');
    await stateManager.initialize();
    orchestrator = new SubAgentOrchestrator();
    aggregator = new FindingAggregator();
    decisionMatrix = new DecisionMatrix();

    // Mock console to avoid cluttering test output
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should complete full review flow with sub-agents and decision matrix', async () => {
    // Mock PR
    const mockPR = {
      id: 'E2E-123',
      platform: 'gitlab',
      project_id: 'test/repo',
      title: 'Add new feature',
      updated_at: new Date().toISOString()
    };

    // Mock config with all features enabled
    const mockConfig = {
      features: {
        useStateManagement: true,
        useSubAgents: true,
        useDecisionMatrix: true  // Enable decision matrix feature
      },
      review: {
        maxDaysBack: 7,
        prStates: ['open'],
        excludeLabels: ['wip', 'draft'],
        maxFilesPerPR: 50,
        maxLinesPerFile: 1000,
        contextLines: 10,
        minCoveragePercent: 80,
        maxComplexity: 10
      },
      platforms: {
        gitlab: {
          enabled: true
        }
      },
      claude: {
        apiKey: 'test-key',
        model: 'claude-3-opus-20240229',
        maxTokens: 4096,
        temperature: 0.3
      },
      output: {
        dryRun: true,
        postComments: true,
        postSummary: true,
        approveIfNoIssues: false
      }
    };

    // Create feature flags
    const featureFlags = new FeatureFlags(mockConfig.features);

    // Phase 1: Create and initialize state
    const state = new ReviewState(mockPR.id, mockPR.platform, mockPR.project_id);

    // Transition to context gathering
    state.transitionTo('context_gathering');

    // Set up context (simulating Context.buildContext)
    state.context = {
      metadata: {
        title: mockPR.title,
        author: 'test-author',
        description: 'Test PR description'
      },
      repository: {
        language: 'javascript',
        dependencies: ['jest', '@modelcontextprotocol/sdk']
      },
      diff: {
        additions: 50,
        deletions: 20,
        files: [
          {
            new_path: 'src/feature.js',
            old_path: 'src/feature.js',
            diff: '@@ -10,3 +10,10 @@\n function feature() {\n-  console.log("old");\n+  console.log("new");\n+  if (condition) {\n+    process();\n+  }\n }'
          },
          {
            new_path: 'tests/feature.test.js',
            old_path: 'tests/feature.test.js',
            diff: '@@ -1,0 +1,5 @@\n+test("feature works", () => {\n+  const result = feature();\n+  expect(result).toBe(true);\n+});'
          }
        ]
      },
      stats: {
        coverage: { before: 85, after: 82, delta: -3 },
        complexity: 5,
        filesChanged: 2
      }
    };

    // Save state after context gathering
    await stateManager.saveState(state);

    // Phase 2: Parallel Analysis with Sub-Agents
    if (featureFlags.isEnabled('useSubAgents')) {
      state.transitionTo('parallel_analysis');

      // Mock SubAgentOrchestrator responses
      orchestrator.invokeAgent = jest.fn()
        .mockImplementation((agentName) => {
          const responses = {
            'test-analyzer': {
              findings: [
                {
                  file: 'src/feature.js',
                  line: 12,
                  severity: 'major',
                  category: 'test_coverage',
                  message: 'New code lacks test coverage - coverage decreased by 3%'
                }
              ],
              metrics: { coverage_delta: -3 }
            },
            'security-analyzer': {
              findings: [
                {
                  file: 'src/feature.js',
                  line: 11,
                  severity: 'minor',
                  category: 'security',
                  message: 'Console output may expose sensitive information'
                }
              ],
              metrics: { security_score: 8.5 }
            },
            'performance-analyzer': {
              findings: [
                {
                  file: 'src/feature.js',
                  line: 13,
                  severity: 'minor',
                  category: 'performance',
                  message: 'Synchronous process() call may block event loop'
                }
              ],
              metrics: { avg_complexity: 'O(n)' }
            },
            'architecture-analyzer': {
              findings: [
                {
                  file: 'src/feature.js',
                  severity: 'minor',
                  category: 'architecture',
                  message: 'Function violates Single Responsibility Principle'
                }
              ],
              metrics: { solid_violations: { srp: 1, ocp: 0, lsp: 0, isp: 0, dip: 0 } }
            }
          };

          return Promise.resolve(JSON.stringify(responses[agentName] || { findings: [] }));
        });

      // Execute parallel analysis
      await orchestrator.executeParallelAnalysis(state, mockConfig);
    }

    // Phase 3: Synthesis with Decision Matrix
    state.transitionTo('synthesis');

    // Aggregate findings
    const aggregationResult = aggregator.aggregate(state);

    // Collect metrics for decision making
    const metrics = {
      coverage_delta: -3,
      complexity_increase: 0,
      files_changed: state.context.stats.filesChanged
    };

    // Make decision using DecisionMatrix when enabled
    let decision;
    if (featureFlags.isEnabled('useDecisionMatrix')) {
      decision = decisionMatrix.decide(aggregationResult.aggregated, metrics);
    } else {
      // Fallback to simple decision logic
      const hasCritical = aggregationResult.aggregated.some(f => f.severity === 'critical');
      decision = {
        decision: hasCritical ? 'changes_requested' : 'approved',
        rationale: hasCritical ? 'Critical issues found' : 'No critical issues',
        total_findings: aggregationResult.total,
        critical_count: aggregationResult.aggregated.filter(f => f.severity === 'critical').length,
        major_count: aggregationResult.aggregated.filter(f => f.severity === 'major').length,
        minor_count: aggregationResult.aggregated.filter(f => f.severity === 'minor').length,
        coverage_delta: metrics.coverage_delta
      };
    }

    // Update state with synthesis results
    state.synthesis = {
      aggregated: aggregationResult.aggregated,
      conflicts: aggregationResult.conflicts,
      decision: decision.decision,
      rationale: decision.rationale,
      metadata: {
        total_findings: decision.total_findings,
        critical_count: decision.critical_count,
        major_count: decision.major_count,
        minor_count: decision.minor_count,
        coverage_delta: decision.coverage_delta
      }
    };

    // Phase 4: Output Generation
    state.transitionTo('output');

    // Generate output
    state.output = {
      comments: aggregationResult.aggregated,
      summary: `Review complete: ${decision.decision}. ${decision.rationale}`,
      status: 'success'
    };

    // Mark as complete
    state.transitionTo('completed');

    // Save final state
    await stateManager.saveState(state);

    // Load and verify final state
    const finalState = await stateManager.loadState(
      mockPR.id,
      mockPR.platform,
      mockPR.project_id
    );

    // Phase 1: Context gathering assertions
    expect(finalState.context).toBeDefined();
    expect(finalState.context.metadata.title).toBe(mockPR.title);
    expect(finalState.context.diff.files).toHaveLength(2);

    // Phase 2: Parallel analysis assertions
    expect(finalState.findings).toBeDefined();
    expect(finalState.findings.test).toBeDefined();
    expect(finalState.findings.test).toHaveLength(1);
    expect(finalState.findings.security).toBeDefined();
    expect(finalState.findings.security).toHaveLength(1);
    expect(finalState.findings.performance).toBeDefined();
    expect(finalState.findings.performance).toHaveLength(1);
    expect(finalState.findings.architecture).toBeDefined();
    expect(finalState.findings.architecture).toHaveLength(1);

    // Phase 3: Synthesis assertions
    expect(finalState.synthesis).toBeDefined();
    expect(finalState.synthesis.aggregated).toBeDefined();
    expect(finalState.synthesis.decision).toBeDefined();
    expect(finalState.synthesis.rationale).toBeDefined();
    expect(finalState.synthesis.metadata).toBeDefined();
    expect(finalState.synthesis.metadata.total_findings).toBe(4);
    expect(finalState.synthesis.metadata.critical_count).toBe(0);
    expect(finalState.synthesis.metadata.major_count).toBe(1);
    expect(finalState.synthesis.metadata.minor_count).toBe(3);
    expect(finalState.synthesis.metadata.coverage_delta).toBe(-3);

    // Decision should be 'approved_with_comments' (1 major < threshold of 3, -3% coverage > threshold of -5%)
    expect(finalState.synthesis.decision).toBe('approved_with_comments');

    // Phase 4: Output generation assertions
    expect(finalState.output).toBeDefined();
    expect(finalState.output.status).toBe('success');
    expect(finalState.output.comments).toBeDefined();
    expect(finalState.output.summary).toBeDefined();

    // Final phase should be 'complete'
    expect(finalState.phase).toBe('completed');

    // Verify state transition history via checkpoints
    expect(finalState.checkpoints).toBeDefined();
    expect(finalState.checkpoints.length).toBeGreaterThan(0);
    const phases = finalState.checkpoints.map(c => c.toPhase);
    expect(phases).toContain('context_gathering');
    expect(phases).toContain('parallel_analysis');
    expect(phases).toContain('synthesis');
    expect(phases).toContain('output');
    expect(phases).toContain('completed');

    // Verify orchestrator was called for all agents
    expect(orchestrator.invokeAgent).toHaveBeenCalledTimes(4);
    expect(orchestrator.invokeAgent).toHaveBeenCalledWith('test-analyzer', expect.any(String));
    expect(orchestrator.invokeAgent).toHaveBeenCalledWith('security-analyzer', expect.any(String));
    expect(orchestrator.invokeAgent).toHaveBeenCalledWith('performance-analyzer', expect.any(String));
    expect(orchestrator.invokeAgent).toHaveBeenCalledWith('architecture-analyzer', expect.any(String));
  });

  it('should handle sub-agent failures gracefully', async () => {
    const mockPR = {
      id: 'E2E-fail-456',
      platform: 'github',
      project_id: 'test/repo-fail',
      title: 'Feature with failures',
      updated_at: new Date().toISOString()
    };

    const mockConfig = {
      features: {
        useStateManagement: true,
        useSubAgents: true,
        useDecisionMatrix: true
      },
      output: {
        dryRun: true
      }
    };

    const featureFlags = new FeatureFlags(mockConfig.features);
    const state = new ReviewState(mockPR.id, mockPR.platform, mockPR.project_id);

    // Set minimal context
    state.context = {
      metadata: { title: mockPR.title },
      repository: { language: 'javascript' },
      diff: { additions: 10, deletions: 5, files: [] },
      stats: { filesChanged: 1 }
    };

    // Transition to parallel analysis
    state.transitionTo('parallel_analysis');

    // Mock addError to track errors
    state.addError = jest.fn();

    // Mock mixed success/failure responses
    orchestrator.invokeAgent = jest.fn()
      .mockImplementation((agentName) => {
        if (agentName === 'security-analyzer') {
          return Promise.reject(new Error('Security scan timeout'));
        }
        if (agentName === 'performance-analyzer') {
          return Promise.reject(new Error('Performance analysis failed'));
        }
        return Promise.resolve(JSON.stringify({
          findings: [{
            file: 'test.js',
            severity: 'minor',
            category: agentName.replace('-analyzer', ''),
            message: `Finding from ${agentName}`
          }]
        }));
      });

    // Execute parallel analysis - should handle failures gracefully
    await orchestrator.executeParallelAnalysis(state, mockConfig);

    // Should have findings from successful agents
    expect(state.findings.test).toHaveLength(1);
    expect(state.findings.architecture).toHaveLength(1);

    // Failed agents should have empty arrays
    expect(state.findings.security).toHaveLength(0);
    expect(state.findings.performance).toHaveLength(0);

    // Continue with synthesis
    state.transitionTo('synthesis');
    const aggregationResult = aggregator.aggregate(state);
    const metrics = { coverage_delta: 0, complexity_increase: 0, files_changed: 1 };
    const decision = decisionMatrix.decide(aggregationResult.aggregated, metrics);

    state.synthesis = {
      aggregated: aggregationResult.aggregated,
      conflicts: aggregationResult.conflicts,
      decision: decision.decision,
      rationale: decision.rationale,
      metadata: {
        total_findings: decision.total_findings,
        critical_count: decision.critical_count,
        major_count: decision.major_count,
        minor_count: decision.minor_count,
        coverage_delta: metrics.coverage_delta
      }
    };

    // Generate output
    state.transitionTo('output');
    state.output = {
      comments: aggregationResult.aggregated,
      summary: `Review complete despite failures: ${decision.decision}`,
      status: 'success'
    };

    // Complete
    state.transitionTo('completed');
    await stateManager.saveState(state);

    const finalState = await stateManager.loadState(
      mockPR.id,
      mockPR.platform,
      mockPR.project_id
    );

    // Should still complete synthesis and generate output
    expect(finalState.synthesis).toBeDefined();
    expect(finalState.synthesis.decision).toBeDefined();
    expect(finalState.output).toBeDefined();
    expect(finalState.phase).toBe('completed');

    // Check that errors were recorded via addError calls
    expect(state.addError).toHaveBeenCalledTimes(2);
    expect(state.addError).toHaveBeenCalledWith('parallel_analysis', expect.objectContaining({
      message: 'Security scan timeout'
    }));
    expect(state.addError).toHaveBeenCalledWith('parallel_analysis', expect.objectContaining({
      message: 'Performance analysis failed'
    }));
  });

  it('should use DecisionMatrix for critical findings', async () => {
    const mockPR = {
      id: 'E2E-matrix-789',
      platform: 'gitlab',
      project_id: 'test/matrix-repo',
      title: 'Test DecisionMatrix integration',
      updated_at: new Date().toISOString()
    };

    const mockConfig = {
      features: {
        useStateManagement: true,
        useSubAgents: true,
        useDecisionMatrix: true
      },
      output: { dryRun: true }
    };

    const featureFlags = new FeatureFlags(mockConfig.features);
    const state = new ReviewState(mockPR.id, mockPR.platform, mockPR.project_id);

    // Set context with significant coverage drop
    state.context = {
      metadata: { title: mockPR.title },
      repository: { language: 'javascript' },
      diff: { additions: 20, deletions: 10, files: [] },
      stats: {
        filesChanged: 1,
        coverage: { delta: -10 }
      }
    };

    state.transitionTo('parallel_analysis');

    // Mock a critical security finding
    orchestrator.invokeAgent = jest.fn()
      .mockImplementation((agentName) => {
        if (agentName === 'security-analyzer') {
          return Promise.resolve(JSON.stringify({
            findings: [{
              file: 'auth.js',
              severity: 'critical',
              category: 'security',
              message: 'SQL injection vulnerability detected'
            }]
          }));
        }
        return Promise.resolve(JSON.stringify({ findings: [] }));
      });

    await orchestrator.executeParallelAnalysis(state, mockConfig);

    // Synthesis with DecisionMatrix
    state.transitionTo('synthesis');
    const aggregationResult = aggregator.aggregate(state);
    const metrics = { coverage_delta: -10, complexity_increase: 0, files_changed: 1 };

    // DecisionMatrix should handle critical findings appropriately
    const decision = decisionMatrix.decide(aggregationResult.aggregated, metrics);

    // DecisionMatrix should reject PR with critical finding
    expect(decision.decision).toBe('changes_requested');
    expect(decision.rationale).toContain('critical');
    expect(decision.critical_count).toBe(1);

    state.synthesis = {
      aggregated: aggregationResult.aggregated,
      conflicts: aggregationResult.conflicts,
      decision: decision.decision,
      rationale: decision.rationale,
      metadata: {
        total_findings: decision.total_findings,
        critical_count: decision.critical_count,
        major_count: decision.major_count,
        minor_count: decision.minor_count,
        coverage_delta: metrics.coverage_delta
      }
    };

    state.transitionTo('completed');
    await stateManager.saveState(state);

    const finalState = await stateManager.loadState(
      mockPR.id,
      mockPR.platform,
      mockPR.project_id
    );

    expect(finalState.synthesis.decision).toBe('changes_requested');
    expect(finalState.synthesis.rationale).toContain('critical');
    expect(finalState.synthesis.metadata.critical_count).toBe(1);
  });
});