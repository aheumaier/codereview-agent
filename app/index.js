#!/usr/bin/env node

import { loadConfig, validateConfig } from './config.js';
import tracker from './tracker.js';
import discovery from './discovery.js';
import context from './context.js';
import review from './review.js';
import output from './output.js';
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

    try {
      // Load and validate configuration
      console.log('📋 Loading configuration...');
      const config = await loadConfig();
      validateConfig(config);

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

          // Check if already reviewed (skip this check in dry-run mode)
          const isDryRun = config.output.dryRun === true || config.output.dryRun === 'true';

          if (!isDryRun) {
            const alreadyReviewed = await tracker.hasReviewed(
              pr.platform,
              pr.project_id || pr.repository,
              pr.id,
              pr.updated_at
            );

            if (alreadyReviewed) {
              console.log('⏭️  Already reviewed, skipping...');
              skipped++;
              continue;
            }
          } else {
            console.log('🔸 DRY RUN MODE - Ignoring review history');
          }

          // Build context
          console.log('📦 Building context...');
          const prContext = await context.buildContext(pr, config);

          if (prContext.error) {
            console.error(`❌ Context error: ${prContext.error}`);
            errors++;
            continue;
          }

          console.log(`   Files: ${prContext.stats.filesChanged}`);
          console.log(`   Changes: +${prContext.stats.additions} -${prContext.stats.deletions}`);

          // Perform review
          console.log('🧠 Analyzing with Claude...');
          const reviewResult = await review.reviewPR(prContext, config);

          if (reviewResult.error) {
            console.error(`❌ Review error: ${reviewResult.error}`);
            errors++;
            continue;
          }

          console.log(`   Decision: ${reviewResult.decision}`);
          console.log(`   Issues: ${reviewResult.comments?.length || 0}`);

          // Post review
          console.log('📮 Posting review...');
          const postResult = await output.postReview(pr, reviewResult, config);

          if (postResult.dryRun) {
            console.log('🔸 DRY RUN - Review not posted');
          } else if (postResult.posted) {
            console.log('✅ Review posted successfully');
          } else {
            console.error(`❌ Failed to post: ${postResult.error}`);
            errors++;
            continue;
          }

          // Mark as reviewed (skip in dry-run mode to avoid polluting history)
          if (!isDryRun) {
            await tracker.markReviewed({
              platform: pr.platform,
              repository: pr.project_id || pr.repository,
              prId: pr.id,
              sha: pr.sha || pr.head_sha,
              summary: reviewResult.summary,
              decision: reviewResult.decision,
              comments: reviewResult.comments,
              prUpdatedAt: pr.updated_at
            });
          }

          reviewed++;

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
      try {
        await tracker.close();
      } catch (error) {
        console.error('Failed to close tracker:', error);
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