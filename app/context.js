import {
  createConnectedGitLabClient,
  createConnectedGitHubClient,
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

      // Check if diff response is an error
      if (diff?.error) {
        throw new Error(`Failed to get GitLab MR diff: ${diff.error}`);
      }

      // Ensure diff is an array before processing
      if (!Array.isArray(diff)) {
        console.error('GitLab diff response is not an array:', diff);
        throw new Error('Invalid GitLab diff response format');
      }

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
   * Build GitHub PR context via MCP
   * @param {Object} pr - Pull request object
   * @param {Object} config - Configuration
   * @param {Object} baseContext - Base context object
   * @returns {Promise<Object>} GitHub PR context
   */
  async buildGitHubContext(pr, config, baseContext) {
    const platformConfig = config.platforms.github;
    if (!platformConfig?.token) {
      return {
        ...baseContext,
        error: 'GitHub token must be configured'
      };
    }

    // Validate repository format for GitHub
    if (!isNonEmptyString(pr.repository)) {
      return {
        ...baseContext,
        error: 'GitHub PR must have a valid repository'
      };
    }

    // Parse owner/repo from repository string
    const [owner, repo] = pr.repository.split('/');
    if (!owner || !repo) {
      return {
        ...baseContext,
        error: `Invalid GitHub repository format: ${pr.repository} (expected owner/repo)`
      };
    }

    let client, transport;

    try {
      // Create MCP client using shared utility for consistency
      const connection = await createConnectedGitHubClient({
        token: platformConfig.token,
        repositories: platformConfig.repositories || []
      });
      client = connection.client;
      transport = connection.transport;

      console.log(`  DEBUG - Calling get_pull_request with: owner="${owner}", repo="${repo}", pullNumber=${parseInt(pr.id)}`);

      // Get PR details first to ensure we have all necessary data
      const prDetailsResponse = await retryWithBackoff(
        async () => client.callTool({
          name: 'get_pull_request',
          arguments: {
            owner,
            repo,
            pullNumber: parseInt(pr.id)
          }
        }),
        {
          maxRetries: 3,
          initialDelay: 1000,
          shouldRetry: isRetryableError,
          onRetry: (error, attempt, delay) => {
            console.log(`  Retrying GitHub PR details request (attempt ${attempt}/3) after ${delay}ms: ${error.message}`);
          }
        }
      );

      console.log('  DEBUG - get_pull_request response content:', JSON.stringify(prDetailsResponse?.content?.[0], null, 2));
      const prDetails = parseMCPResponse(prDetailsResponse);

      // Check if PR details response is an error
      if (prDetails?.error) {
        throw new Error(`Failed to get GitHub PR details: ${prDetails.error}`);
      }

      // Get changed files for the PR
      const filesResponse = await retryWithBackoff(
        async () => client.callTool({
          name: 'get_pull_request_files',
          arguments: {
            owner,
            repo,
            pullNumber: parseInt(pr.id)
          }
        }),
        {
          maxRetries: 3,
          initialDelay: 1000,
          shouldRetry: isRetryableError,
          onRetry: (error, attempt, delay) => {
            console.log(`  Retrying GitHub files request (attempt ${attempt}/3) after ${delay}ms: ${error.message}`);
          }
        }
      );

      console.log('  DEBUG - get_pull_request_files response content:', JSON.stringify(filesResponse?.content?.[0], null, 2));
      const changedFiles = parseMCPResponse(filesResponse);

      // Check if changed files response is an error
      if (changedFiles?.error) {
        throw new Error(`Failed to get GitHub PR files: ${changedFiles.error}`);
      }

      // Ensure changedFiles is an array before mapping
      if (!Array.isArray(changedFiles)) {
        console.error('GitHub files response is not an array:', changedFiles);
        throw new Error('Invalid GitHub files response format');
      }

      // Transform GitHub files to our diff format
      const diff = changedFiles.map(file => ({
        old_path: file.previous_filename || file.filename,
        new_path: file.filename,
        diff: file.patch || '',
        new_file: file.status === 'added',
        deleted_file: file.status === 'removed',
        renamed_file: file.status === 'renamed',
        additions: file.additions || 0,
        deletions: file.deletions || 0,
        changes: file.changes || 0
      }));

      // Apply limits
      const limitedDiff = this.applyLimits(diff, config.review);

      // Calculate statistics
      const stats = this.calculateStats(limitedDiff);

      // Get file contents for important files (new or modified files)
      const files = await this.getGitHubFileContents(
        client,
        owner,
        repo,
        pr,
        limitedDiff,
        config
      );

      // Store PR metadata for output phase
      return {
        pr: {
          ...pr,
          // Add GitHub-specific metadata needed for posting reviews
          owner,
          repo,
          number: parseInt(pr.id),
          head_sha: prDetails.head?.sha || pr._raw?.head?.sha,
          base_sha: prDetails.base?.sha || pr._raw?.base?.sha
        },
        diff: limitedDiff,
        files,
        stats
      };

    } catch (error) {
      const mcpError = new MCPError('GitHub context building failed', 'github', error);
      console.error('GitHub context error:', mcpError.getFullMessage());
      return {
        ...baseContext,
        error: `Failed to get GitHub PR context: ${error.message}`
      };
    } finally {
      await safeCloseClient(client, 'GitHub context building');
      // Close transport if it exists
      if (transport) {
        try {
          await transport.close();
        } catch (e) {
          console.warn('Failed to close GitHub transport:', e.message);
        }
      }
    }
  }

  /**
   * Get file contents from GitHub for analysis
   * @param {Client} client - MCP client
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {Object} pr - Pull request object
   * @param {Array} diff - Diff array
   * @param {Object} config - Configuration
   * @returns {Promise<Array>} Array of file contents
   */
  async getGitHubFileContents(client, owner, repo, pr, diff, config) {
    const files = [];
    const importantFiles = diff.filter(file => {
      // Skip deleted files
      if (file.deleted_file) return false;

      // Check for important file patterns
      const path = file.new_path || file.old_path;
      const isConfig = /\.(json|yaml|yml|toml|ini)$/i.test(path);
      const isCode = /\.(js|ts|py|rb|java|go|rs|cpp|c|h|cs)$/i.test(path);
      const isTest = /test|spec/i.test(path);

      return isConfig || isCode || isTest;
    }).slice(0, config.review.maxFilesPerPR || 10); // Limit files to analyze

    for (const file of importantFiles) {
      try {
        const response = await retryWithBackoff(
          async () => client.callTool({
            name: 'get_file_contents',
            arguments: {
              owner,
              repo,
              path: file.new_path,
              ref: pr.source_branch || pr._raw?.head?.ref
            }
          }),
          {
            maxRetries: 2,
            initialDelay: 500,
            shouldRetry: isRetryableError
          }
        );

        const content = parseMCPResponse(response);

        // Skip if content is an error
        if (content?.error) {
          console.warn(`Failed to parse content for ${file.new_path}: ${content.error}`);
        } else if (content) {
          files.push({
            path: file.new_path,
            content: typeof content === 'string' ? content : content.content || '',
            encoding: content.encoding || 'utf8'
          });
        }
      } catch (error) {
        console.warn(`Failed to get content for ${file.new_path}: ${error.message}`);
      }
    }

    return files;
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

          // Skip if content is an error
          if (content?.error) {
            console.warn(`Failed to parse content for ${fileName}: ${content.error}`);
          } else if (content && content.content) {
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