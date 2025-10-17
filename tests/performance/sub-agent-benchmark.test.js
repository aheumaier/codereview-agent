import { performance } from 'perf_hooks';
import { jest } from '@jest/globals';
import SubAgentOrchestrator from '../../app/agents/SubAgentOrchestrator.js';
import ReviewState from '../../app/state/ReviewState.js';

describe('Performance: Sub-Agent Execution', () => {
  let orchestrator;
  let originalInvokeAgent;

  beforeEach(() => {
    orchestrator = new SubAgentOrchestrator();

    // Store original method for sequential test
    originalInvokeAgent = orchestrator.invokeAgent.bind(orchestrator);

    // Mock invokeAgent for consistent performance testing
    orchestrator.invokeAgent = jest.fn()
      .mockImplementation(async (agentName, state) => {
        // Simulate realistic agent processing time
        // Different agents have different complexity
        const processingTimes = {
          'security-agent': 150,
          'design-agent': 120,
          'performance-agent': 100,
          'testing-agent': 80
        };

        const delay = processingTimes[agentName] || 100;
        await new Promise(resolve => setTimeout(resolve, delay));

        // Return valid response matching agent schemas
        return JSON.stringify({
          findings: generateMockFindings(agentName, state),
          metrics: generateMockMetrics(agentName),
          severity: 'info',
          agent: agentName,
          timestamp: new Date().toISOString()
        });
      });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should complete small PR (<5 files) in <10 seconds', async () => {
    const state = createMockState(5);

    const start = performance.now();
    await orchestrator.executeParallelAnalysis(state, {});
    const duration = performance.now() - start;

    console.log(`Small PR (5 files) completed in ${(duration / 1000).toFixed(2)}s`);

    expect(duration).toBeLessThan(10000); // 10 seconds
    expect(orchestrator.invokeAgent).toHaveBeenCalledTimes(4); // All 4 agents
  });

  it('should complete medium PR (25 files) in <30 seconds', async () => {
    const state = createMockState(25);

    const start = performance.now();
    await orchestrator.executeParallelAnalysis(state, {});
    const duration = performance.now() - start;

    console.log(`Medium PR (25 files) completed in ${(duration / 1000).toFixed(2)}s`);

    expect(duration).toBeLessThan(30000); // 30 seconds
    expect(orchestrator.invokeAgent).toHaveBeenCalledTimes(4);
  });

  it('should complete large PR (50 files) in <60 seconds', async () => {
    const state = createMockState(50);

    const start = performance.now();
    await orchestrator.executeParallelAnalysis(state, {});
    const duration = performance.now() - start;

    console.log(`Large PR (50 files) completed in ${(duration / 1000).toFixed(2)}s`);

    expect(duration).toBeLessThan(60000); // 60 seconds as per requirement
    expect(orchestrator.invokeAgent).toHaveBeenCalledTimes(4);
  });

  it('should be significantly faster than sequential execution', async () => {
    const state = createMockState(25);
    const agents = ['security-agent', 'design-agent', 'performance-agent', 'testing-agent'];

    // Measure parallel execution
    const parallelStart = performance.now();
    await orchestrator.executeParallelAnalysis(state, {});
    const parallelDuration = performance.now() - parallelStart;

    // Simulate sequential execution
    const sequentialStart = performance.now();
    for (const agentName of agents) {
      await orchestrator.invokeAgent(agentName, state);
    }
    const sequentialDuration = performance.now() - sequentialStart;

    const speedup = sequentialDuration / parallelDuration;

    console.log(`Performance comparison for 25 files:`);
    console.log(`  Parallel:   ${parallelDuration.toFixed(0)}ms`);
    console.log(`  Sequential: ${sequentialDuration.toFixed(0)}ms`);
    console.log(`  Speedup:    ${speedup.toFixed(2)}x faster`);

    // Parallel should be at least 2x faster with 4 agents
    expect(parallelDuration).toBeLessThan(sequentialDuration);
    expect(speedup).toBeGreaterThan(2.0);
  });

  it('should handle very large PR (100 files) gracefully', async () => {
    const state = createMockState(100);

    const start = performance.now();
    await orchestrator.executeParallelAnalysis(state, {});
    const duration = performance.now() - start;

    console.log(`Very large PR (100 files) completed in ${(duration / 1000).toFixed(2)}s`);

    // Should still complete in reasonable time even with 100 files
    expect(duration).toBeLessThan(120000); // 2 minutes max
    expect(orchestrator.invokeAgent).toHaveBeenCalledTimes(4);
  });

  it('should maintain consistent performance across multiple runs', async () => {
    const state = createMockState(25);
    const durations = [];

    // Run 5 times to check consistency
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      await orchestrator.executeParallelAnalysis(state, {});
      const duration = performance.now() - start;
      durations.push(duration);
    }

    const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
    const variance = durations.reduce((sum, d) => sum + Math.pow(d - avgDuration, 2), 0) / durations.length;
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = (stdDev / avgDuration) * 100;

    console.log(`Performance consistency (5 runs, 25 files):`);
    console.log(`  Average:    ${avgDuration.toFixed(0)}ms`);
    console.log(`  Std Dev:    ${stdDev.toFixed(0)}ms`);
    console.log(`  CV:         ${coefficientOfVariation.toFixed(1)}%`);

    // Coefficient of variation should be low (< 20%) for consistent performance
    expect(coefficientOfVariation).toBeLessThan(20);
  });

  it('should demonstrate efficient parallel scaling', async () => {
    const fileCounts = [10, 20, 30, 40, 50];
    const results = [];

    for (const fileCount of fileCounts) {
      const state = createMockState(fileCount);

      const start = performance.now();
      await orchestrator.executeParallelAnalysis(state, {});
      const duration = performance.now() - start;

      results.push({
        files: fileCount,
        duration: duration,
        perFile: duration / fileCount
      });
    }

    console.log('\nScaling analysis:');
    console.log('Files | Duration | Per File');
    console.log('------|----------|----------');
    results.forEach(r => {
      console.log(`${r.files.toString().padStart(5)} | ${r.duration.toFixed(0).padStart(8)}ms | ${r.perFile.toFixed(1).padStart(8)}ms`);
    });

    // Due to parallel execution, total time should not increase linearly
    // The duration for 50 files should be less than 2x the duration for 10 files
    const smallDuration = results.find(r => r.files === 10).duration;
    const largeDuration = results.find(r => r.files === 50).duration;

    console.log(`\nEfficiency: 50 files took ${(largeDuration / smallDuration).toFixed(2)}x as long as 10 files`);
    console.log(`(Linear scaling would be 5.0x, parallel efficiency achieved ${(5.0 / (largeDuration / smallDuration)).toFixed(2)}x speedup)`);

    // Parallel processing should provide at least 2x efficiency over linear scaling
    expect(largeDuration).toBeLessThan(smallDuration * 2.5); // Much better than linear (5x)
  });
});

/**
 * Creates a mock ReviewState with specified number of files
 * @param {number} fileCount - Number of files to include in the PR
 * @returns {ReviewState} - Mock state with realistic PR data
 */
function createMockState(fileCount) {
  const state = new ReviewState(`PERF-${fileCount}`, 'gitlab', 'org/repo');

  const files = [];
  for (let i = 0; i < fileCount; i++) {
    const fileType = i % 3 === 0 ? 'js' : i % 3 === 1 ? 'py' : 'rb';
    const linesChanged = 10 + Math.floor(Math.random() * 40); // 10-50 lines per file

    files.push({
      new_path: `src/module${Math.floor(i / 10)}/file${i}.${fileType}`,
      old_path: `src/module${Math.floor(i / 10)}/file${i}.${fileType}`,
      diff: generateRealisticDiff(i, linesChanged),
      additions: Math.floor(linesChanged * 0.6),
      deletions: Math.floor(linesChanged * 0.4)
    });
  }

  state.context = {
    diff: {
      files,
      additions: files.reduce((sum, f) => sum + f.additions, 0),
      deletions: files.reduce((sum, f) => sum + f.deletions, 0)
    },
    stats: {
      filesChanged: fileCount,
      additions: files.reduce((sum, f) => sum + f.additions, 0),
      deletions: files.reduce((sum, f) => sum + f.deletions, 0)
    },
    prDetails: {
      title: `Performance test PR with ${fileCount} files`,
      description: 'Automated performance benchmark test',
      author: 'test-user',
      created_at: new Date().toISOString()
    }
  };

  return state;
}

/**
 * Generates realistic diff content for testing
 * @param {number} fileIndex - Index of the file
 * @param {number} linesChanged - Number of lines changed
 * @returns {string} - Diff string
 */
function generateRealisticDiff(fileIndex, linesChanged) {
  const chunks = Math.ceil(linesChanged / 10);
  let diff = '';

  for (let chunk = 0; chunk < chunks; chunk++) {
    const startLine = chunk * 20 + 1;
    const contextLines = 3;
    const changedLines = Math.min(10, linesChanged - (chunk * 10));

    diff += `@@ -${startLine},${contextLines + changedLines} +${startLine},${contextLines + changedLines} @@\n`;

    // Add context lines
    for (let i = 0; i < contextLines; i++) {
      diff += ` function context${i}() { /* unchanged */ }\n`;
    }

    // Add changed lines
    for (let i = 0; i < changedLines; i++) {
      if (i % 2 === 0) {
        diff += `-  oldFunction${fileIndex}_${i}() { return 'old'; }\n`;
        diff += `+  newFunction${fileIndex}_${i}() { return 'improved'; }\n`;
      } else {
        diff += `-  // Old comment\n`;
        diff += `+  // New improved comment with better documentation\n`;
      }
    }
  }

  return diff;
}

/**
 * Generates mock findings based on agent type and state
 * @param {string} agentName - Name of the agent
 * @param {ReviewState} state - Current review state
 * @returns {Array} - Array of mock findings
 */
function generateMockFindings(agentName, state) {
  const fileCount = state.context.stats.filesChanged;
  const findingsCount = Math.min(5, Math.floor(fileCount / 10));
  const findings = [];

  const templates = {
    'security-agent': [
      { type: 'sql_injection', severity: 'critical' },
      { type: 'xss_vulnerability', severity: 'major' },
      { type: 'weak_encryption', severity: 'major' }
    ],
    'design-agent': [
      { type: 'single_responsibility', severity: 'minor' },
      { type: 'dependency_inversion', severity: 'major' }
    ],
    'performance-agent': [
      { type: 'n_plus_one_query', severity: 'major' },
      { type: 'inefficient_algorithm', severity: 'minor' }
    ],
    'testing-agent': [
      { type: 'missing_tests', severity: 'major' },
      { type: 'low_coverage', severity: 'minor' }
    ]
  };

  const agentTemplates = templates[agentName] || [];

  for (let i = 0; i < findingsCount && i < agentTemplates.length; i++) {
    findings.push({
      ...agentTemplates[i],
      file: `src/file${i}.js`,
      line: Math.floor(Math.random() * 100) + 1,
      message: `Mock finding from ${agentName}`
    });
  }

  return findings;
}

/**
 * Generates mock metrics based on agent type
 * @param {string} agentName - Name of the agent
 * @returns {Object} - Mock metrics object
 */
function generateMockMetrics(agentName) {
  const metrics = {
    'security-agent': {
      vulnerabilities: 0,
      securityScore: 95
    },
    'design-agent': {
      solidViolations: 2,
      codeComplexity: 12
    },
    'performance-agent': {
      algorithmicComplexity: 'O(n)',
      queryCount: 15
    },
    'testing-agent': {
      coverage: 85,
      testCount: 42
    }
  };

  return metrics[agentName] || {};
}

export default describe;