#!/usr/bin/env node

import { loadConfig, validateConfig } from './config.js';
import Tracker from './tracker.js';
import Discovery from './discovery.js';
import Context from './context.js';
import Review from './review.js';
import Output from './output.js';
import StateManager from './state/StateManager.js';
import FeatureFlags from './utils/featureFlags.js';
import FindingAggregator from './synthesis/FindingAggregator.js';
import DecisionMatrix from './synthesis/DecisionMatrix.js';
import {
  ConfigurationError,
  PlatformError,
  MCPError,
  CodeReviewError
} from './utils/errorHelpers.js';
import { isNonEmptyString, isValidDate } from './utils/validators.js';

/**
 * Main orchestrator for the code review agent
 */
class CodeReviewAgent {
  /**
   * Run state-managed review flow
   * @param {ReviewState} state - Review state object
   * @param {Object} config - Configuration
   * @param {FeatureFlags} featureFlags - Feature flags
   */
  async runStateManagedReview(state, config, featureFlags) {
    const context = new Context();
    const review = new Review();
    const output = new Output();

    try {
      // Gather context
      console.log('📦 Gathering context...');
      await this.gatherContext(state, config, context);

      // Check if sub-agents enabled
      let reviewResult;
      if (featureFlags.isEnabled('useSubAgents')) {
        // Transition to parallel analysis phase
        state.transitionTo('parallel_analysis');
        console.log('🔄 Running parallel sub-agent analysis...');

        const SubAgentOrchestrator = (await import('./agents/SubAgentOrchestrator.js')).default;
        const orchestrator = new SubAgentOrchestrator(config);
        await orchestrator.executeParallelAnalysis(state, config);

        // Aggregate findings from all agents
        const allFindings = [
          ...state.findings.test,
          ...state.findings.security,
          ...state.findings.performance,
          ...state.findings.architecture
        ];

        // Create reviewResult from aggregated findings
        reviewResult = {
          decision: allFindings.some(f => f.severity === 'critical') ? 'changes_requested' : 'approved',
          summary: `Sub-agent analysis complete: ${allFindings.length} findings`,
          comments: allFindings,
          testFindings: state.findings.test,
          securityFindings: state.findings.security,
          performanceFindings: state.findings.performance,
          architectureFindings: state.findings.architecture
        };
      }

      // Transition to synthesis
      state.transitionTo('synthesis');
      console.log('🔄 Synthesizing results...');

      // Create synthesis components
      const aggregator = new FindingAggregator();
      const decisionMatrix = new DecisionMatrix();

      // Aggregate findings from all sub-agents
      const aggregationResult = aggregator.aggregate(state);

      // Collect metrics from state
      const metrics = this.collectMetrics(state);

      // Make decision based on aggregated findings
      const decision = decisionMatrix.decide(aggregationResult.aggregated, metrics);

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

      // Log synthesis results
      console.log(`📊 Aggregated ${aggregationResult.total} findings`);
      if (aggregationResult.conflicts.length > 0) {
        console.log(`⚠️  Detected ${aggregationResult.conflicts.length} conflicts`);
      }
      console.log(`✅ Decision: ${decision.decision}`);
      console.log(`💭 Rationale: ${decision.rationale}`);

      // Transition to output
      state.transitionTo('output');
      console.log('📮 Generating output...');

      // Generate output
      state.output = {
        comments: reviewResult.comments || [],
        summary: reviewResult.summary,
        status: 'success'
      };

      // Post review
      const pr = {
        id: state.prId,
        platform: state.platform,
        project_id: state.repository,
        repository: state.repository,
        ...state.context.metadata
      };

      const postResult = await output.postReview(pr, reviewResult, config);
      console.log(postResult.dryRun ? '🔸 DRY RUN - Review not posted' : '✅ Review posted');

      return { success: true, state };

    } catch (error) {
      state.addError(state.phase, error);
      throw error;
    }
  }

  /**
   * Gather context and populate state
   * @param {ReviewState} state - Review state
   * @param {Object} config - Configuration
   * @param {Context} context - Context builder
   */
  async gatherContext(state, config, context) {
    const pr = {
      id: state.prId,
      iid: state.iid,  // GitLab internal ID
      platform: state.platform,
      project_path: state.repository,  // Use path format for MCP calls
      project_id: state.repository,
      repository: state.repository,
      source_branch: state.branch,
      target_branch: state.baseBranch
    };

    const prContext = await context.buildContext(pr, config);

    if (prContext.error) {
      throw new Error(`Context error: ${prContext.error}`);
    }

    // Populate state with context
    state.context = {
      metadata: {
        title: prContext.title || pr.id,
        author: prContext.author,
        description: prContext.description
      },
      repository: {
        language: prContext.language,
        dependencies: prContext.dependencies
      },
      diff: {
        additions: prContext.stats?.additions || 0,
        deletions: prContext.stats?.deletions || 0,
        files: prContext.diff || []  // Use prContext.diff (actual code diffs), not prContext.files (metadata)
      },
      stats: {
        coverage: prContext.coverage,
        complexity: prContext.complexity,
        filesChanged: prContext.stats?.filesChanged || 0
      }
    };
  }

  /**
   * Collect metrics from state for decision making
   * @param {ReviewState} state - Review state
   * @returns {Object} Metrics object
   */
  collectMetrics(state) {
    const metrics = {
      coverage_delta: 0,
      complexity_increase: 0,
      files_changed: state.context?.stats?.filesChanged || 0
    };

    // Calculate coverage delta if available
    if (state.context?.stats?.coverage) {
      const coverage = state.context.stats.coverage;
      if (coverage.before !== undefined && coverage.after !== undefined) {
        metrics.coverage_delta = coverage.after - coverage.before;
      } else if (coverage.delta !== undefined) {
        metrics.coverage_delta = coverage.delta;
      }
    }

    // Collect metrics from sub-agent findings if available
    if (state.findings) {
      // Test metrics
      const testFindings = state.findings.test || [];
      const coverageFindings = testFindings.filter(f =>
        f.message && f.message.toLowerCase().includes('coverage')
      );
      if (coverageFindings.length > 0) {
        // Extract coverage delta from findings if not already set
        coverageFindings.forEach(finding => {
          const match = finding.message.match(/decreased by ([\d.]+)%/);
          if (match && !metrics.coverage_delta) {
            metrics.coverage_delta = -parseFloat(match[1]);
          }
        });
      }

      // Performance metrics
      const perfFindings = state.findings.performance || [];
      const complexityFindings = perfFindings.filter(f =>
        f.message && f.message.toLowerCase().includes('complexity')
      );
      metrics.complexity_issues = complexityFindings.length;
    }

    return metrics;
  }


  /**
   * Validate PR object has required fields
   * @param {Object} pr - Pull request object to validate
   * @returns {boolean} True if valid, false otherwise
   */
  validatePR(pr) {
    // Required fields
    if (!pr || typeof pr !== 'object') {
      console.error('PR validation failed: PR is not an object');
      return false;
    }

    if (!isNonEmptyString(pr.platform)) {
      console.error('PR validation failed: Missing or invalid platform');
      return false;
    }

    if (!isNonEmptyString(pr.id)) {
      console.error('PR validation failed: Missing or invalid id');
      return false;
    }

    // Must have either project_id (GitLab) or repository (GitHub/Bitbucket)
    if (!isNonEmptyString(pr.project_id) && !isNonEmptyString(pr.repository)) {
      console.error('PR validation failed: Missing project_id or repository');
      return false;
    }

    // Optional fields - validate if present
    if (pr.updated_at && !isValidDate(pr.updated_at)) {
      console.error(`PR validation warning: Invalid updated_at date: ${pr.updated_at}`);
    }

    if (pr.title !== undefined && !isNonEmptyString(pr.title)) {
      console.error('PR validation warning: title is present but empty');
    }

    // GitLab specific validation
    if (pr.platform === 'gitlab' && pr.iid !== undefined) {
      if (typeof pr.iid !== 'string' && typeof pr.iid !== 'number') {
        console.error('PR validation warning: GitLab iid should be string or number');
      }
    }

    return true;
  }

  /**
   * Run the code review agent
   */
  async run() {
    console.log('🤖 Code Review Agent Starting...\n');

    let tracker; // Define tracker here for finally block access
    let stateManager; // State manager for new flow

    try {
      // Load and validate configuration
      console.log('📋 Loading configuration...');
      const config = await loadConfig();
      validateConfig(config);

      // Initialize feature flags
      const featureFlags = FeatureFlags.fromConfig(config);

      if (featureFlags.isEnabled('useStateManagement')) {
        console.log('🔧 State management enabled');
      } else {
        console.log('🔧 Legacy mode enabled');
      }

      // Instantiate dependencies
      tracker = new Tracker();
      const discovery = new Discovery();

      // Initialize state manager if feature is enabled
      if (featureFlags.isEnabled('useStateManagement')) {
        stateManager = new StateManager(config.tracking.dbPath);
        await stateManager.initialize();
        console.log('📊 State manager initialized');
      }

      // Initialize tracker
      console.log('🗄️ Initializing review tracker...');
      await tracker.initialize(config.tracking.dbPath);

      // Clean up old reviews
      if (config.tracking.ttlDays) {
        const deleted = await tracker.cleanup(config.tracking.ttlDays);
        if (deleted > 0) {
          console.log(`🧹 Cleaned up ${deleted} old reviews\n`);
        }
      }

      // Discover PRs
      console.log('🔍 Discovering pull requests...');
      const prs = await discovery.discoverPRs(config);
      console.log(`📊 Found ${prs.length} pull requests to review\n`);

      if (prs.length === 0) {
        console.log('✅ No pull requests to review');
        return;
      }

      // Process PRs sequentially
      let reviewed = 0;
      let skipped = 0;
      let errors = 0;

      for (const pr of prs) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`📝 Processing: ${pr.title || pr.id}`);
        console.log(`   Platform: ${pr.platform}`);
        console.log(`   Repository: ${pr.project_id || pr.repository}`);
        console.log(`   PR ID: ${pr.id}`);

        try {
          // Validate PR object before processing
          if (!this.validatePR(pr)) {
            console.error('❌ Invalid PR object, skipping...');
            errors++;
            continue;
          }

          // Choose review flow based on feature flag
          if (featureFlags.isEnabled('useStateManagement')) {
            // State-managed flow
            console.log('🔄 Using state-managed review flow');

            // Try to load existing state or create new
            let state = await stateManager.loadState(
              pr.id,
              pr.platform,
              pr.project_path || pr.project_id || pr.repository
            );

            if (!state) {
              state = await stateManager.createState(
                pr.id,
                pr.platform,
                pr.project_path || pr.project_id || pr.repository,
                pr.source_branch,
                pr.target_branch,
                pr.iid  // GitLab internal ID
              );
            } else {
              console.log(`   Resuming from phase: ${state.phase}`);
            }

            // Run state-managed review
            const result = await this.runStateManagedReview(state, config, featureFlags);

            // Save final state
            await stateManager.saveState(state);

            if (result.success) {
              reviewed++;
            } else {
              errors++;
            }
          }

        } catch (error) {
          console.error(`❌ Unexpected error: ${error.message}`);
          errors++;
        }
      }

      // Summary
      console.log(`\n${'='.repeat(60)}`);
      console.log('📈 Review Summary:');
      console.log(`   ✅ Reviewed: ${reviewed}`);
      console.log(`   ⏭️  Skipped: ${skipped}`);
      console.log(`   ❌ Errors: ${errors}`);
      console.log(`   📊 Total: ${prs.length}`);

    } catch (error) {
      // Enhanced error handling with specific error types
      if (error instanceof ConfigurationError) {
        console.error('\n❌ Configuration error:', error.message);
        if (error.configKey) {
          console.error(`   Config key: ${error.configKey}`);
        }
      } else if (error instanceof PlatformError) {
        console.error(`\n❌ ${error.platform} platform error:`, error.message);
        if (error.statusCode) {
          console.error(`   Status code: ${error.statusCode}`);
        }
      } else if (error instanceof MCPError) {
        console.error('\n❌ MCP communication error:', error.message);
        if (error.tool) {
          console.error(`   Tool: ${error.tool}`);
        }
      } else if (error instanceof CodeReviewError) {
        console.error('\n❌ Code review error:', error.message);
      } else {
        console.error('\n❌ Fatal error:', error.message);
      }

      // Show error chain if available
      if (error.cause) {
        console.error('   Caused by:', error.cause.message);
      }

      // Show stack trace in debug mode
      if (process.env.DEBUG === 'true' && error.stack) {
        console.error('\nStack trace:', error.stack);
      }

      process.exit(1);
    } finally {
      // Clean up
      if (tracker) {
        try {
          await tracker.close();
        } catch (error) {
          console.error('Failed to close tracker:', error);
        }
      }
      if (stateManager) {
        try {
          await stateManager.close();
        } catch (error) {
          console.error('Failed to close state manager:', error);
        }
      }
    }

    console.log('\n✨ Code Review Agent Complete!');
    process.exit(0);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const agent = new CodeReviewAgent();
  agent.run().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default CodeReviewAgent;