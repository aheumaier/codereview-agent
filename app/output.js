import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'child_process';

/**
 * Output handler for posting review results
 */
class Output {
  /**
   * Post review results to PR
   * @param {Object} pr - Pull request object
   * @param {Object} review - Review results
   * @param {Object} config - Configuration
   * @returns {Promise<Object>} Posting result
   */
  async postReview(pr, review, config) {
    // Check dry-run mode
    if (config.output.dryRun === true || config.output.dryRun === 'true') {
      console.log('DRY RUN MODE - Not posting review');
      console.log('\n' + '='.repeat(60));
      console.log('📋 SUMMARY COMMENT:');
      console.log('='.repeat(60));
      console.log(this.formatSummary(review));

      // Show detailed comments
      if (review.comments && review.comments.length > 0) {
        console.log('\n' + '='.repeat(60));
        console.log(`💬 DETAILED COMMENTS (${review.comments.length} total):`);
        console.log('='.repeat(60) + '\n');

        review.comments.forEach((comment, index) => {
          console.log(`[${index + 1}/${review.comments.length}]`);

          // Show location if available
          if (comment.file) {
            console.log(`📍 Location: ${comment.file}${comment.line ? `:${comment.line}` : ''}`);
          }

          // Show formatted comment
          console.log(this.formatComment(comment));
          console.log('\n' + '-'.repeat(60) + '\n');
        });

        console.log('✅ Dry-run complete - No changes posted to platform\n');
      } else {
        console.log('\n✅ No inline comments to post\n');
      }

      return {
        posted: false,
        dryRun: true,
        summary: this.formatSummary(review),
        comments: review.comments
      };
    }

    try {
      switch (pr.platform) {
        case 'gitlab':
          return await this.postGitLabReview(pr, review, config);
        case 'github':
          return await this.postGitHubReview(pr, review, config);
        case 'bitbucket':
          return await this.postBitbucketReview(pr, review, config);
        default:
          return {
            posted: false,
            error: `Unsupported platform: ${pr.platform}`
          };
      }
    } catch (error) {
      console.error('Failed to post review:', error);
      return {
        posted: false,
        error: `Failed to post review: ${error.message}`
      };
    }
  }

  /**
   * Post review to GitLab MR via MCP
   * @param {Object} pr - Merge request object
   * @param {Object} review - Review results
   * @param {Object} config - Configuration
   * @returns {Promise<Object>} Posting result
   */
  async postGitLabReview(pr, review, config) {
    const platformConfig = config.platforms.gitlab;
    if (!platformConfig?.mcpServerPath) {
      return {
        posted: false,
        error: 'GitLab MCP server not configured'
      };
    }

    let client;
    let transport;

    try {
      // Start MCP server process
      const serverProcess = spawn('node', [platformConfig.mcpServerPath], {
        env: {
          ...process.env,
          GITLAB_TOKEN: platformConfig.token,
          GITLAB_URL: platformConfig.url
        }
      });

      // Create transport and client
      transport = new StdioClientTransport({
        command: serverProcess.command,
        args: serverProcess.args,
        env: serverProcess.env
      });

      client = new Client({
        name: 'codereview-agent',
        version: '1.0.0'
      }, {
        capabilities: {}
      });

      await client.connect(transport);

      let postedCount = 0;

      // Post summary comment
      if (config.output.postSummary !== false) {
        await client.request({
          method: 'tools/call',
          params: {
            name: 'mcp__gitlab__create_note',
            arguments: {
              project_id: pr.project_id,
              noteable_type: 'merge_request',
              noteable_iid: pr.iid || pr.id,
              body: this.formatSummary(review)
            }
          }
        });
        postedCount++;
      }

      // Post inline comments
      if (config.output.postComments !== false && review.comments?.length > 0) {
        for (const comment of review.comments) {
          if (comment.file && comment.line) {
            // Post as inline comment on diff
            await client.request({
              method: 'tools/call',
              params: {
                name: 'mcp__gitlab__create_merge_request_thread',
                arguments: {
                  project_id: pr.project_id,
                  merge_request_iid: pr.iid || pr.id,
                  body: this.formatComment(comment),
                  position: {
                    position_type: 'text',
                    base_sha: pr.diff_refs?.base_sha || pr.base_sha,
                    head_sha: pr.diff_refs?.head_sha || pr.head_sha,
                    start_sha: pr.diff_refs?.start_sha || pr.start_sha,
                    new_path: comment.file,
                    old_path: comment.file,
                    new_line: comment.line
                  }
                }
              }
            });
          } else {
            // Post as general comment
            await client.request({
              method: 'tools/call',
              params: {
                name: 'mcp__gitlab__create_note',
                arguments: {
                  project_id: pr.project_id,
                  noteable_type: 'merge_request',
                  noteable_iid: pr.iid || pr.id,
                  body: this.formatComment(comment)
                }
              }
            });
          }
          postedCount++;
        }
      }

      // Approve if configured and no issues
      if (config.output.approveIfNoIssues &&
          review.decision === 'approved' &&
          review.issues?.critical === 0 &&
          review.issues?.major === 0) {
        await client.request({
          method: 'tools/call',
          params: {
            name: 'mcp__gitlab__approve_merge_request',
            arguments: {
              project_id: pr.project_id,
              merge_request_iid: pr.iid || pr.id
            }
          }
        });
      }

      return {
        posted: true,
        count: postedCount,
        decision: review.decision
      };

    } finally {
      if (client) {
        await client.close();
      }
    }
  }

  /**
   * Post review to GitHub PR (stub)
   * @param {Object} pr - Pull request object
   * @param {Object} review - Review results
   * @param {Object} config - Configuration
   * @returns {Promise<Object>} Posting result
   */
  async postGitHubReview(pr, review, config) {
    return {
      posted: false,
      error: 'GitHub output not implemented'
    };
  }

  /**
   * Post review to Bitbucket PR (stub)
   * @param {Object} pr - Pull request object
   * @param {Object} review - Review results
   * @param {Object} config - Configuration
   * @returns {Promise<Object>} Posting result
   */
  async postBitbucketReview(pr, review, config) {
    return {
      posted: false,
      error: 'Bitbucket output not implemented'
    };
  }

  /**
   * Format review summary for posting
   * @param {Object} review - Review results
   * @returns {string} Formatted summary
   */
  formatSummary(review) {
    const statusEmoji = {
      approved: '✅',
      needs_work: '⚠️',
      changes_requested: '❌',
      error: '🚫'
    };

    const emoji = statusEmoji[review.decision] || '📝';
    const totalIssues = (review.issues?.critical || 0) +
                        (review.issues?.major || 0) +
                        (review.issues?.minor || 0);

    let summary = `## ${emoji} Code Review Summary\n\n`;
    summary += `**Decision:** ${review.decision}\n\n`;

    if (review.issues) {
      summary += `### Issues Found\n`;
      summary += `- Critical: ${review.issues.critical || 0}\n`;
      summary += `- Major: ${review.issues.major || 0}\n`;
      summary += `- Minor: ${review.issues.minor || 0}\n`;
      summary += `- **Total Issues:** ${totalIssues}\n\n`;
    }

    if (review.summary) {
      summary += `### Review Details\n${review.summary}\n\n`;
    }

    summary += `---\n`;
    summary += `*This review was generated automatically by CodeReview Agent using Claude AI.*`;

    return summary;
  }

  /**
   * Format individual comment for posting
   * @param {Object} comment - Comment object
   * @returns {string} Formatted comment
   */
  formatComment(comment) {
    const severityEmoji = {
      critical: '🔴',
      major: '🟡',
      minor: '🔵'
    };

    const emoji = severityEmoji[comment.severity] || '💬';
    let formatted = `${emoji} **[${comment.severity?.toUpperCase() || 'INFO'}]** `;

    // Main issue description
    formatted += comment.message;

    // Why this matters
    if (comment.why) {
      formatted += `\n\n**Why this matters:**\n${comment.why}`;
    }

    // Suggested fix with code
    if (comment.suggestion) {
      formatted += `\n\n**Suggestion:**\n\`\`\`\n${comment.suggestion}\n\`\`\``;
    }

    // Learning resources
    if (comment.resources) {
      formatted += `\n\n**Learn more:** ${comment.resources}`;
    }

    return formatted;
  }
}

export default new Output();