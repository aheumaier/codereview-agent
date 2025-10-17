import { spawn } from 'child_process';
import {
  createConnectedGitLabClient,
  createConnectedGitHubClient,
  safeCloseClient,
  parseMCPResponse
} from './mcp-utils.js';
import { getPRCutoffDate } from './utils/dateHelpers.js';
import { PlatformError, createPlatformError, wrapError, ConfigurationError } from './utils/errorHelpers.js';
import { validateProjectId } from './utils/validators.js';
import { retryWithBackoff, isRetryableError } from './utils/retry.js';

/**
 * Discovery module for finding PRs across platforms
 */
class Discovery {
  /**
   * Discover PRs from all enabled platforms
   * @param {Object} config - Configuration object
   * @returns {Promise<Array>} List of discovered PRs
   */
  async discoverPRs(config) {
    const allPRs = [];

    for (const [platform, platformConfig] of Object.entries(config.platforms)) {
      if (!platformConfig.enabled) continue;

      try {
        const prs = await this.discoverPlatformPRs(platform, platformConfig, config.review);
        allPRs.push(...prs);
      } catch (error) {
        const wrappedError = wrapError(error, `Failed to discover PRs from ${platform}`);
        console.error(`Failed to discover PRs from ${platform}:`, wrappedError.message);
        if (wrappedError.cause) {
          console.error('  Caused by:', wrappedError.cause.message);
        }
      }
    }

    return allPRs;
  }

  /**
   * Discover PRs from a specific platform
   * @param {string} platform - Platform name
   * @param {Object} platformConfig - Platform configuration
   * @param {Object} reviewConfig - Review configuration
   * @returns {Promise<Array>} List of PRs from the platform
   */
  async discoverPlatformPRs(platform, platformConfig, reviewConfig) {
    switch (platform) {
      case 'gitlab':
        return await this.discoverGitLabPRs(platformConfig, reviewConfig);
      case 'github':
        return await this.discoverGitHubPRs(platformConfig, reviewConfig);
      case 'bitbucket':
        return await this.discoverBitbucketPRs(platformConfig, reviewConfig);
      default:
        return [];
    }
  }

  /**
   * Discover GitLab merge requests via @zereight/mcp-gitlab
   * @param {Object} platformConfig - GitLab configuration
   * @param {Object} reviewConfig - Review configuration
   * @returns {Promise<Array>} List of GitLab MRs
   */
  async discoverGitLabPRs(platformConfig, reviewConfig) {
    console.log('Discovering GitLab MRs using @zereight/mcp-gitlab...');

    let client;

    try {
      const projectId = platformConfig.projectId || process.env.GITLAB_PROJECT_ID;
      const token = platformConfig.token || process.env.GITLAB_PERSONAL_ACCESS_TOKEN;
      const apiUrl = platformConfig.url || process.env.GITLAB_API_URL || 'https://gitlab.com/api/v4';

      // Validate projectId
      if (!projectId) {
        throw new ConfigurationError('GitLab projectId is required but not provided', 'platforms.gitlab.projectId');
      }

      if (!validateProjectId(projectId)) {
        throw new ConfigurationError(
          `Invalid GitLab project ID format: ${projectId}. Must be a group ID (e.g., 'my-group') or project path (e.g., 'group/project')`,
          'platforms.gitlab.projectId'
        );
      }

      // Debug logging
      console.log(`  Project ID: ${projectId}`);
      console.log(`  API URL: ${apiUrl}`);
      console.log(`  Token present: ${token ? 'Yes' : 'No'}`);

      // Check if projectId is a group (no slash) or a project (has slash)
      const isGroup = projectId && !projectId.includes('/') && !projectId.includes('%2F');

      let allPRs = [];

      if (isGroup) {
        console.log(`  Detected group: ${projectId}, using group-level MR endpoint...`);

        // Use direct GitLab API for group-level MRs since MCP doesn't support it
        const groupMRs = await this.fetchGroupMRsDirectly(projectId, token, apiUrl, reviewConfig);
        allPRs.push(...groupMRs);

        console.log(`  Total MRs found in group: ${allPRs.length}`);

      } else {
        // Single project - create MCP client for project-level queries
        client = await createConnectedGitLabClient({
          token,
          url: apiUrl,
          projectId: projectId || '',
          readOnly: false
        });

        console.log(`  Listing MRs for project: ${projectId}`);

        // Calculate date range
        const sinceDate = getPRCutoffDate(reviewConfig.maxDaysBack);

        const response = await retryWithBackoff(
          async () => client.callTool({
            name: 'list_merge_requests',
            arguments: {
              project_id: projectId,
              state: reviewConfig.prStates.includes('open') ? 'opened' : 'all',
              created_after: sinceDate.toISOString(),
              per_page: 100
            }
          }),
          {
            maxRetries: 3,
            initialDelay: 1000,
            shouldRetry: isRetryableError,
            onRetry: (error, attempt, delay) => {
              console.log(`  Retrying GitLab MCP call (attempt ${attempt}/3) after ${delay}ms: ${error.message}`);
            }
          }
        );

        allPRs = this.filterGitLabPRs(parseMCPResponse(response), reviewConfig);
      }

      return allPRs.map(pr => ({
        platform: 'gitlab',
        project_path: platformConfig.projectId,  // Add path format for MCP calls
        ...pr
      }));

    } catch (error) {
      const platformError = createPlatformError('GitLab', 'discovery', error);
      console.error('GitLab discovery error:', platformError.getFullMessage());
      return [];
    } finally {
      // Clean up MCP client if it was created
      await safeCloseClient(client, 'GitLab discovery');
    }
  }

  /**
   * Fetch group merge requests directly via GitLab API
   * @param {string} groupId - GitLab group ID
   * @param {string} token - GitLab personal access token
   * @param {string} apiUrl - GitLab API URL
   * @param {Object} reviewConfig - Review configuration
   * @returns {Promise<Array>} List of merge requests
   */
  async fetchGroupMRsDirectly(groupId, token, apiUrl, reviewConfig) {
    // Validate groupId
    if (!validateProjectId(groupId)) {
      throw new ConfigurationError(
        `Invalid GitLab group ID format: ${groupId}. Must be a valid group identifier`,
        'groupId'
      );
    }

    const sinceDate = getPRCutoffDate(reviewConfig.maxDaysBack);

    const state = reviewConfig.prStates.includes('open') ? 'opened' : 'all';
    const url = `${apiUrl}/groups/${encodeURIComponent(groupId)}/merge_requests?state=${state}&created_after=${sinceDate.toISOString()}&per_page=100`;

    try {
      const response = await retryWithBackoff(
        async () => {
          const res = await fetch(url, {
            headers: {
              'PRIVATE-TOKEN': token
            }
          });

          if (!res.ok) {
            const errorText = await res.text();
            const apiError = new Error(`${res.statusText}: ${errorText}`);
            apiError.statusCode = res.status;
            throw new PlatformError(
              `GitLab API request failed`,
              'gitlab',
              res.status,
              apiError
            );
          }

          return res;
        },
        {
          maxRetries: 3,
          initialDelay: 1000,
          shouldRetry: isRetryableError,
          onRetry: (error, attempt, delay) => {
            console.log(`  Retrying GitLab API call (attempt ${attempt}/3) after ${delay}ms: ${error.message}`);
          }
        }
      );

      const mrs = await response.json();

      // Filter by excluded labels
      return mrs.filter(mr => {
        if (mr.labels && reviewConfig.excludeLabels) {
          const hasExcludedLabel = mr.labels.some(label =>
            reviewConfig.excludeLabels.includes(label.toLowerCase())
          );
          if (hasExcludedLabel) return false;
        }
        return true;
      });

    } catch (error) {
      const platformError = error instanceof PlatformError
        ? error
        : createPlatformError('GitLab', 'group MR fetch', error);
      console.error('Failed to fetch group MRs directly:', platformError.getFullMessage());
      return [];
    }
  }

  /**
   * Filter GitLab PRs based on review configuration
   * @param {Array} prs - Array of parsed PRs
   * @param {Object} reviewConfig - Review configuration
   * @returns {Array} Filtered PRs
   */
  filterGitLabPRs(prs, reviewConfig) {
    if (!Array.isArray(prs)) {
      return [];
    }

    // Filter by date and labels
    const cutoffDate = getPRCutoffDate(reviewConfig.maxDaysBack);

    return prs.filter(pr => {
      // Check date
      const createdAt = new Date(pr.created_at);
      if (createdAt < cutoffDate) return false;

      // Check excluded labels
      if (pr.labels && reviewConfig.excludeLabels) {
        const hasExcludedLabel = pr.labels.some(label =>
          reviewConfig.excludeLabels.includes(label.toLowerCase())
        );
        if (hasExcludedLabel) return false;
      }

      return true;
    });
  }

  /**
   * Discover GitHub PRs via GitHub MCP server
   * @param {Object} platformConfig - GitHub configuration
   * @param {Object} reviewConfig - Review configuration
   * @returns {Promise<Array>} List of GitHub PRs
   */
  async discoverGitHubPRs(platformConfig, reviewConfig) {
    console.log('Discovering GitHub PRs using GitHub MCP server...');

    let client, transport;

    try {
      const token = platformConfig.token || process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
      const repositories = platformConfig.repositories || [];

      if (!token) {
        throw new ConfigurationError('GitHub token is required but not provided', 'platforms.github.token');
      }

      if (!repositories.length) {
        console.warn('No repositories configured for GitHub - will discover from all accessible repos');
      }

      // Debug logging
      console.log(`  Token present: ${token ? 'Yes' : 'No'}`);
      console.log(`  Repositories configured: ${repositories.length}`);

      // Create MCP client for GitHub
      const connection = await createConnectedGitHubClient({
        token,
        repositories
      });
      client = connection.client;
      transport = connection.transport;

      const allPRs = [];
      const sinceDate = getPRCutoffDate(reviewConfig.maxDaysBack);

      // If specific repositories are configured, query each one
      if (repositories.length > 0) {
        for (const repo of repositories) {
          console.log(`  Listing PRs for repository: ${repo}`);

          // Parse owner/repo format
          const [owner, repoName] = repo.split('/');
          if (!owner || !repoName) {
            console.warn(`Invalid repository format: ${repo} (expected owner/repo)`);
            continue;
          }

          let response;
          try {
            response = await retryWithBackoff(
              async () => {
                console.log('  DEBUG - Calling GitHub MCP callTool...');
                const result = await client.callTool({
                  name: 'list_pull_requests',
                  arguments: {
                    owner,
                    repo: repoName,
                    state: reviewConfig.prStates.includes('open') ? 'open' : 'all',
                    perPage: 100
                  }
                });
                console.log('  DEBUG - callTool succeeded, response type:', typeof result);
                return result;
              },
              {
                maxRetries: 3,
                initialDelay: 1000,
                shouldRetry: isRetryableError,
                onRetry: (error, attempt, delay) => {
                  console.log(`  Retrying GitHub MCP call (attempt ${attempt}/3) after ${delay}ms: ${error.message}`);
                  console.log('  Error stack:', error.stack);
                }
              }
            );
          } catch (error) {
            console.error('  MCP callTool failed:', error.message);
            console.error('  Error stack:', error.stack);
            throw error;
          }

          // Debug: Log response structure
          console.log('  DEBUG - GitHub MCP response keys:', Object.keys(response || {}));
          if (response?.content) {
            console.log('  DEBUG - response.content type:', Array.isArray(response.content) ? 'array' : typeof response.content);
            console.log('  DEBUG - response.content length:', response.content?.length);
          }
          if (response?.result) {
            console.log('  DEBUG - response.result type:', typeof response.result);
          }

          const prs = parseMCPResponse(response);
          const filteredPRs = this.filterGitHubPRs(prs, reviewConfig, sinceDate);

          // Add repository info to each PR
          const prsWithRepo = filteredPRs.map(pr => ({
            ...pr,
            repository: repo,
            owner,
            repo: repoName
          }));

          allPRs.push(...prsWithRepo);
        }
      } else {
        // If no specific repositories, list from all accessible repos
        console.log('  Listing PRs from all accessible repositories');

        const response = await retryWithBackoff(
          async () => client.callTool({
            name: 'list_pull_requests',
            arguments: {
              state: reviewConfig.prStates.includes('open') ? 'open' : 'all',
              perPage: 100
            }
          }),
          {
            maxRetries: 3,
            initialDelay: 1000,
            shouldRetry: isRetryableError,
            onRetry: (error, attempt, delay) => {
              console.log(`  Retrying GitHub MCP call (attempt ${attempt}/3) after ${delay}ms: ${error.message}`);
            }
          }
        );

        const prs = parseMCPResponse(response);
        const filteredPRs = this.filterGitHubPRs(prs, reviewConfig, sinceDate);
        allPRs.push(...filteredPRs);
      }

      console.log(`  Total PRs found: ${allPRs.length}`);

      // Transform to common format
      return allPRs.map(pr => ({
        platform: 'github',
        id: pr.number?.toString() || pr.id?.toString(),
        repository: pr.repository || `${pr.owner}/${pr.repo}`,
        title: pr.title,
        author: pr.user?.login || pr.author,
        source_branch: pr.head?.ref || pr.source_branch,
        target_branch: pr.base?.ref || pr.target_branch || 'main',
        updated_at: pr.updated_at,
        created_at: pr.created_at,
        state: pr.state,
        // Store raw PR data for context building
        _raw: pr
      }));

    } catch (error) {
      const platformError = createPlatformError('GitHub', 'discovery', error);
      console.error('GitHub discovery error:', platformError.getFullMessage());
      return [];
    } finally {
      // Clean up MCP client if it was created
      await safeCloseClient(client, 'GitHub discovery');
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
   * Filter GitHub PRs based on review configuration
   * @param {Array} prs - Array of parsed PRs
   * @param {Object} reviewConfig - Review configuration
   * @param {Date} sinceDate - Cutoff date for PR creation
   * @returns {Array} Filtered PRs
   */
  filterGitHubPRs(prs, reviewConfig, sinceDate) {
    if (!Array.isArray(prs)) {
      return [];
    }

    return prs.filter(pr => {
      // Check date
      const createdAt = new Date(pr.created_at);
      if (createdAt < sinceDate) return false;

      // Check excluded labels
      if (pr.labels && reviewConfig.excludeLabels) {
        const labelNames = pr.labels.map(label =>
          typeof label === 'string' ? label : label.name
        ).filter(Boolean);

        const hasExcludedLabel = labelNames.some(label =>
          reviewConfig.excludeLabels.includes(label.toLowerCase())
        );
        if (hasExcludedLabel) return false;
      }

      // Check draft status (GitHub-specific)
      if (pr.draft && reviewConfig.excludeLabels?.includes('draft')) {
        return false;
      }

      return true;
    });
  }

  /**
   * Discover Bitbucket PRs (stub implementation)
   * @param {Object} platformConfig - Bitbucket configuration
   * @param {Object} reviewConfig - Review configuration
   * @returns {Promise<Array>} Empty array (stub)
   */
  async discoverBitbucketPRs(platformConfig, reviewConfig) {
    // Stub implementation - to be implemented later
    console.log('Bitbucket discovery not yet implemented');
    return [];
  }
}

export default Discovery;