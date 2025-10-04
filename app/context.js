import {
  createConnectedGitLabClient,
  safeCloseClient,
  parseMCPResponse
} from './mcp-utils.js';
import { MCPError, wrapError, ConfigurationError } from './utils/errorHelpers.js';
import { isNonEmptyString, validateProjectId, isValidEnum } from './utils/validators.js';
import { retryWithBackoff, isRetryableError } from './utils/retry.js';

/**
 * Context builder for PR analysis
 */
class Context {
  /**
   * Build context for a PR
   * @param {Object} pr - Pull request object
   * @param {Object} config - Configuration object
   * @returns {Promise<Object>} PR context with diff, files, and stats
   */
  async buildContext(pr, config) {
    const baseContext = {
      pr,
      diff: [],
      files: [],
      stats: {
        filesChanged: 0,
        additions: 0,
        deletions: 0,
        totalLines: 0
      }
    };

    // Validate PR object
    if (!pr || typeof pr !== 'object') {
      return {
        ...baseContext,
        error: 'Invalid PR object: must be a non-null object'
      };
    }

    // Validate platform
    const supportedPlatforms = ['gitlab', 'github', 'bitbucket'];
    if (!isValidEnum(pr.platform, supportedPlatforms)) {
      return {
        ...baseContext,
        error: `Invalid or unsupported platform: ${pr.platform}. Must be one of: ${supportedPlatforms.join(', ')}`
      };
    }

    try {
      switch (pr.platform) {
        case 'gitlab':
          return await this.buildGitLabContext(pr, config, baseContext);
        case 'github':
          return await this.buildGitHubContext(pr, config, baseContext);
        case 'bitbucket':
          return await this.buildBitbucketContext(pr, config, baseContext);
        default:
          return {
            ...baseContext,
            error: `Unsupported platform: ${pr.platform}`
          };
      }
    } catch (error) {
      const mcpError = new MCPError('Context building failed', pr.platform, error);
      console.error('Context building error:', mcpError.getFullMessage());
      return {
        ...baseContext,
        error: `Failed to get PR context: ${error.message}`
      };
    }
  }

  /**
   * Build GitLab MR context via MCP
   * @param {Object} pr - Merge request object
   * @param {Object} config - Configuration
   * @param {Object} baseContext - Base context object
   * @returns {Promise<Object>} GitLab MR context
   */
  async buildGitLabContext(pr, config, baseContext) {
    const platformConfig = config.platforms.gitlab;
    if (!platformConfig?.token || !platformConfig?.url) {
      return {
        ...baseContext,
        error: 'GitLab token and URL must be configured'
      };
    }

    // Validate project_id for GitLab
    if (!isNonEmptyString(pr.project_id)) {
      return {
        ...baseContext,
        error: 'GitLab PR must have a valid project_id'
      };
    }

    if (!validateProjectId(pr.project_id)) {
      return {
        ...baseContext,
        error: `Invalid GitLab project_id format: ${pr.project_id}`
      };
    }

    // Validate source_branch if present (needed for file queries)
    if (pr.source_branch && !isNonEmptyString(pr.source_branch)) {
      console.warn('GitLab PR has invalid source_branch, file content queries may fail');
    }

    let client;

    try {
      // Create MCP client using shared utility for consistency
      client = await createConnectedGitLabClient({
        token: platformConfig.token,
        url: platformConfig.url,
        projectId: platformConfig.projectId || pr.project_id,
        readOnly: false
      });

      // Get MR diff with retry logic
      const diffResponse = await retryWithBackoff(
        async () => client.callTool({
          name: 'get_merge_request_diffs',
          arguments: {
            project_id: pr.project_path || platformConfig.projectId || pr.project_id,  // Use path format, fallback to pr.project_id
            merge_request_iid: pr.iid || pr.id
          }
        }),
        {
          maxRetries: 3,
          initialDelay: 1000,
          shouldRetry: isRetryableError,
          onRetry: (error, attempt, delay) => {
            console.log(`  Retrying MCP diff request (attempt ${attempt}/3) after ${delay}ms: ${error.message}`);
          }
        }
      );

      const diff = parseMCPResponse(diffResponse);

      // Apply limits
      const limitedDiff = this.applyLimits(diff, config.review);

      // Calculate statistics
      const stats = this.calculateStats(limitedDiff);

      // Get file contents for important files
      const files = await this.getFileContents(
        client,
        pr,
        limitedDiff,
        config
      );

      return {
        pr,
        diff: limitedDiff,
        files,
        stats
      };

    } finally {
      await safeCloseClient(client, 'GitLab context building');
    }
  }

  /**
   * Build GitHub PR context (stub)
   * @param {Object} pr - Pull request object
   * @param {Object} config - Configuration
   * @param {Object} baseContext - Base context object
   * @returns {Promise<Object>} GitHub PR context
   */
  async buildGitHubContext(pr, config, baseContext) {
    return {
      ...baseContext,
      error: 'GitHub context building not implemented'
    };
  }

  /**
   * Build Bitbucket PR context (stub)
   * @param {Object} pr - Pull request object
   * @param {Object} config - Configuration
   * @param {Object} baseContext - Base context object
   * @returns {Promise<Object>} Bitbucket PR context
   */
  async buildBitbucketContext(pr, config, baseContext) {
    return {
      ...baseContext,
      error: 'Bitbucket context building not implemented'
    };
  }


  /**
   * Apply file and line limits to diff
   * @param {Array} diff - Diff array
   * @param {Object} reviewConfig - Review configuration
   * @returns {Array} Limited diff
   */
  applyLimits(diff, reviewConfig) {
    if (!Array.isArray(diff)) return [];

    let limited = diff;

    // Limit number of files
    if (reviewConfig.maxFilesPerPR && diff.length > reviewConfig.maxFilesPerPR) {
      console.log(`Limiting to ${reviewConfig.maxFilesPerPR} files`);
      limited = diff.slice(0, reviewConfig.maxFilesPerPR);
    }

    // Limit lines per file
    if (reviewConfig.maxLinesPerFile) {
      limited = limited.map(file => {
        if (file.diff) {
          const lines = file.diff.split('\n');
          if (lines.length > reviewConfig.maxLinesPerFile) {
            file.diff = lines.slice(0, reviewConfig.maxLinesPerFile).join('\n');
            file.truncated = true;
          }
        }
        return file;
      });
    }

    return limited;
  }

  /**
   * Calculate diff statistics
   * @param {Array} diff - Diff array
   * @returns {Object} Statistics
   */
  calculateStats(diff) {
    const stats = {
      filesChanged: diff.length,
      additions: 0,
      deletions: 0,
      totalLines: 0
    };

    for (const file of diff) {
      if (file.diff) {
        const lines = file.diff.split('\n');
        for (const line of lines) {
          if (line.startsWith('+') && !line.startsWith('+++')) {
            stats.additions++;
          } else if (line.startsWith('-') && !line.startsWith('---')) {
            stats.deletions++;
          }
        }
      }
    }

    stats.totalLines = stats.additions + stats.deletions;
    return stats;
  }

  /**
   * Get file contents for important files
   * @param {Object} client - MCP client
   * @param {Object} pr - Pull request
   * @param {Array} diff - Diff array
   * @param {Object} config - Configuration
   * @returns {Promise<Array>} File contents
   */
  async getFileContents(client, pr, diff, config) {
    const files = [];
    const importantFiles = ['package.json', 'Dockerfile', '.env', 'config.json'];
    const platformConfig = config.platforms?.[pr.platform] || {};

    for (const file of diff) {
      const fileName = file.new_path || file.old_path;
      if (!fileName) continue;

      const fileType = this.detectFileType(fileName);
      const isImportant = importantFiles.some(f => fileName.endsWith(f));

      const fileInfo = {
        path: fileName,
        type: fileType,
        hasChanges: true
      };

      // Get content for important files
      if (isImportant && pr.platform === 'gitlab') {
        try {
          const contentResponse = await retryWithBackoff(
            async () => client.callTool({
              name: 'get_file_contents',
              arguments: {
                project_id: pr.project_path || platformConfig.projectId || pr.project_id,  // Use path format, fallback to pr.project_id
                file_path: fileName,
                ref: pr.source_branch
              }
            }),
            {
              maxRetries: 3,
              initialDelay: 1000,
              shouldRetry: isRetryableError,
              onRetry: (error, attempt, delay) => {
                console.log(`  Retrying file content request for ${fileName} (attempt ${attempt}/3) after ${delay}ms`);
              }
            }
          );

          const content = parseMCPResponse(contentResponse);
          if (content && content.content) {
            fileInfo.content = content.content;
          }
        } catch (error) {
          console.error(`Failed to get content for ${fileName}:`, error);
        }
      }

      files.push(fileInfo);
    }

    return files;
  }

  /**
   * Detect file type from path
   * @param {string} filePath - File path
   * @returns {string} File type
   */
  detectFileType(filePath) {
    const name = filePath.toLowerCase();

    if (name.includes('.env') || name.includes('secret')) {
      return 'sensitive';
    }
    if (name.endsWith('.json') || name.endsWith('.yml') || name.endsWith('.yaml')) {
      return 'config';
    }
    if (name.includes('dockerfile') || name.endsWith('.dockerfile')) {
      return 'docker';
    }
    if (name.endsWith('.js') || name.endsWith('.ts')) {
      return 'javascript';
    }
    if (name.endsWith('.py')) {
      return 'python';
    }
    if (name.endsWith('.rb')) {
      return 'ruby';
    }
    if (name.endsWith('.test.js') || name.endsWith('.spec.js')) {
      return 'test';
    }

    return 'unknown';
  }
}

export default Context;