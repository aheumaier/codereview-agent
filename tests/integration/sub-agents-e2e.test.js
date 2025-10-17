import SubAgentOrchestrator from '../../app/agents/SubAgentOrchestrator.js';
import ReviewState from '../../app/state/ReviewState.js';
import StateManager from '../../app/state/StateManager.js';

describe('Sub-Agents E2E', () => {
  let stateManager;
  let orchestrator;

  beforeEach(async () => {
    stateManager = new StateManager(':memory:');
    await stateManager.initialize();
    orchestrator = new SubAgentOrchestrator();

    // Mock console to avoid cluttering test output
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should complete full parallel analysis flow', async () => {
    const state = new ReviewState('PR-456', 'github', 'org/repo');
    state.context = {
      diff: {
        files: [
          {
            new_path: 'src/main.js',
            diff: '@@ -10,3 +10,5 @@\n function main() {\n-  console.log("old");\n+  console.log("new");\n+  process();\n }'
          }
        ],
        additions: 2,
        deletions: 1
      },
      stats: {
        filesChanged: 1,
        additions: 2,
        deletions: 1
      }
    };

    // Mock successful agent responses
    orchestrator.invokeAgent = jest.fn()
      .mockImplementation((agent) => {
        const responses = {
          'test-analyzer': {
            findings: [
              { file: 'src/main.js', line: 12, severity: 'major', category: 'test_coverage', message: 'Uncovered line' }
            ],
            metrics: { coverage_delta: -2.5 }
          },
          'security-analyzer': {
            findings: [
              { file: 'src/main.js', line: 11, severity: 'minor', category: 'security', message: 'Console output in production' }
            ],
            metrics: { security_score: 8.0 }
          },
          'performance-analyzer': {
            findings: [],
            metrics: { avg_complexity: 'O(n)' }
          },
          'architecture-analyzer': {
            findings: [],
            metrics: { solid_violations: { srp: 0 } }
          }
        };

        return Promise.resolve(JSON.stringify(responses[agent] || { findings: [] }));
      });

    // Save initial state (using correct StateManager method)
    await stateManager.saveState(state);

    // Run parallel analysis
    await orchestrator.executeParallelAnalysis(state, {});

    // Verify all findings populated
    expect(state.findings.test).toHaveLength(1);
    expect(state.findings.security).toHaveLength(1);
    expect(state.findings.performance).toHaveLength(0);
    expect(state.findings.architecture).toHaveLength(0);

    // Verify phase transition
    expect(state.currentPhase).toBe('synthesis');
  });

  it('should populate all finding categories', async () => {
    const state = new ReviewState('PR-789', 'gitlab', 'team/project');
    state.context = {
      diff: { files: [], additions: 0, deletions: 0 },
      stats: { filesChanged: 0 }
    };

    // Mock responses with findings in all categories
    orchestrator.invokeAgent = jest.fn()
      .mockImplementation((agent) => {
        const finding = {
          file: `${agent}.js`,
          severity: 'minor',
          category: agent.replace('-analyzer', ''),
          message: `Finding from ${agent}`
        };

        return Promise.resolve(JSON.stringify({ findings: [finding] }));
      });

    await orchestrator.executeParallelAnalysis(state, {});

    // Verify all categories have findings
    expect(state.findings.test).toHaveLength(1);
    expect(state.findings.security).toHaveLength(1);
    expect(state.findings.performance).toHaveLength(1);
    expect(state.findings.architecture).toHaveLength(1);

    // Verify finding details
    expect(state.findings.test[0].message).toContain('test-analyzer');
    expect(state.findings.security[0].message).toContain('security-analyzer');
    expect(state.findings.performance[0].message).toContain('performance-analyzer');
    expect(state.findings.architecture[0].message).toContain('architecture-analyzer');
  });

  it('should handle state persistence during analysis', async () => {
    const state = new ReviewState('PR-999', 'bitbucket', 'workspace/repo');
    state.context = {
      diff: { files: [], additions: 5, deletions: 3 },
      stats: { filesChanged: 2 }
    };

    // Save state in database
    await stateManager.saveState(state);

    // Mock slow agents to test persistence
    let completedAgents = [];
    orchestrator.invokeAgent = jest.fn()
      .mockImplementation(async (agent) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        completedAgents.push(agent);

        return JSON.stringify({
          findings: [{ file: 'test.js', severity: 'minor', category: 'test', message: agent }]
        });
      });

    await orchestrator.executeParallelAnalysis(state, {});

    // Verify all agents completed
    expect(completedAgents).toHaveLength(4);
    expect(completedAgents).toContain('test-analyzer');
    expect(completedAgents).toContain('security-analyzer');
    expect(completedAgents).toContain('performance-analyzer');
    expect(completedAgents).toContain('architecture-analyzer');

    // Update state in database
    await stateManager.saveState(state);

    // Retrieve and verify persistence
    const loadedState = await stateManager.loadState(state.prId, state.platform, state.repository);
    expect(loadedState).not.toBeNull();
    expect(Object.values(loadedState.findings).flat().length).toBe(4);
    expect(loadedState.currentPhase).toBe('synthesis');
  });

  it('should preserve state on agent failure', async () => {
    const state = new ReviewState('PR-fail', 'github', 'org/repo');
    state.context = {
      diff: { files: [], additions: 1, deletions: 0 },
      stats: { filesChanged: 1 }
    };

    // Mock mixed success/failure
    orchestrator.invokeAgent = jest.fn()
      .mockImplementation((agent) => {
        if (agent === 'security-analyzer') {
          return Promise.reject(new Error('Security scan timeout'));
        }
        if (agent === 'performance-analyzer') {
          return Promise.reject(new Error('Performance analysis failed'));
        }
        return Promise.resolve(JSON.stringify({
          findings: [{ file: 'test.js', severity: 'minor', category: 'test', message: 'Finding' }]
        }));
      });

    // Mock addError
    state.addError = jest.fn();

    await orchestrator.executeParallelAnalysis(state, {});

    // Verify successful agents populated findings
    expect(state.findings.test).toHaveLength(1);
    expect(state.findings.architecture).toHaveLength(1);

    // Verify errors were recorded
    expect(state.addError).toHaveBeenCalledTimes(2);
    expect(state.addError).toHaveBeenCalledWith('parallel_analysis', expect.objectContaining({
      message: 'Security scan timeout'
    }));
    expect(state.addError).toHaveBeenCalledWith('parallel_analysis', expect.objectContaining({
      message: 'Performance analysis failed'
    }));

    // Verify state still transitioned
    expect(state.currentPhase).toBe('synthesis');
  });

  it('should transition through phases correctly', async () => {
    const state = new ReviewState('PR-phase', 'gitlab', 'org/repo');
    state.context = {
      diff: { files: [], additions: 0, deletions: 0 },
      stats: { filesChanged: 0 }
    };

    // Track phase transitions
    const phases = [];
    const originalTransition = state.transitionTo.bind(state);
    state.transitionTo = jest.fn((phase) => {
      phases.push(phase);
      return originalTransition(phase);
    });

    orchestrator.invokeAgent = jest.fn()
      .mockResolvedValue(JSON.stringify({ findings: [] }));

    // Initial phase
    expect(state.currentPhase).toBe('initializing');

    // Transition to parallel_analysis
    state.transitionTo('parallel_analysis');

    // Run analysis
    await orchestrator.executeParallelAnalysis(state, {});

    // Verify phase transitions
    expect(phases).toEqual(['parallel_analysis', 'synthesis']);
    expect(state.currentPhase).toBe('synthesis');
  });
});