import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

/**
 * MCP (Model Context Protocol) utility module for creating consistent MCP clients
 * across the application. This module ensures all MCP connections use the same
 * initialization pattern and environment variables.
 *
 * Implementation notes:
 * - Uses npx pattern for server execution (no local server path needed)
 * - Standardizes environment variable names across all platforms
 * - Provides clean abstraction following SOLID principles
 */

/**
 * Creates a standardized MCP transport for GitLab
 *
 * @param {Object} config - Configuration object
 * @param {string} config.token - GitLab personal access token (required)
 * @param {string} config.url - GitLab API URL (required)
 * @param {string} [config.projectId] - GitLab project ID (optional)
 * @param {boolean} [config.readOnly=false] - Set to true for read-only mode
 * @returns {StdioClientTransport} Configured transport instance
 * @throws {Error} If required configuration is missing
 */
export function createGitLabTransport(config) {
  if (!config.token) {
    throw new Error('GitLab token is required for MCP transport');
  }
  if (!config.url) {
    throw new Error('GitLab API URL is required for MCP transport');
  }

  // Canonical MCP initialization pattern using npx
  // This approach ensures we always use the latest version of the MCP server
  // without needing to maintain local server installations
  return new StdioClientTransport({
    command: 'npx',
    args: ['-y', '@zereight/mcp-gitlab'],
    env: {
      ...process.env,
      GITLAB_PERSONAL_ACCESS_TOKEN: config.token,
      GITLAB_API_URL: config.url,
      // Include project ID if provided (used for project-scoped operations)
      GITLAB_PROJECT_ID: config.projectId || '',
      // Read-only mode prevents accidental modifications
      GITLAB_READ_ONLY_MODE: config.readOnly ? 'true' : 'false'
    }
  });
}

/**
 * Creates a standardized MCP client
 *
 * @param {string} [name='codereview-agent'] - Client name
 * @param {string} [version='1.0.0'] - Client version
 * @returns {Client} Configured MCP client instance
 */
export function createMCPClient(name = 'codereview-agent', version = '1.0.0') {
  return new Client(
    {
      name,
      version
    },
    {
      capabilities: {}
    }
  );
}

/**
 * Creates and connects a GitLab MCP client
 * Combines transport and client creation with connection handling
 *
 * @param {Object} config - Configuration object
 * @param {string} config.token - GitLab personal access token
 * @param {string} config.url - GitLab API URL
 * @param {string} [config.projectId] - GitLab project ID
 * @param {boolean} [config.readOnly=false] - Read-only mode
 * @returns {Promise<Client>} Connected MCP client
 * @throws {Error} If connection fails
 */
export async function createConnectedGitLabClient(config) {
  const transport = createGitLabTransport(config);
  const client = createMCPClient();

  try {
    await client.connect(transport);
    return client;
  } catch (error) {
    throw new Error(`Failed to connect GitLab MCP client: ${error.message}`);
  }
}

/**
 * Safely closes an MCP client
 * Handles errors gracefully to ensure cleanup always succeeds
 *
 * @param {Client} client - MCP client to close
 * @param {string} [context=''] - Optional context for error logging
 * @returns {Promise<void>}
 */
export async function safeCloseClient(client, context = '') {
  if (!client) return;

  try {
    await client.close();
  } catch (error) {
    const contextMsg = context ? ` (${context})` : '';
    console.error(`Warning: MCP client cleanup failed${contextMsg}:`, error.message);
  }
}

/**
 * Parses MCP response content
 * Handles multiple response formats from different MCP servers:
 * - GitLab: Returns JSON string that needs parsing
 * - GitHub: Returns already-parsed objects
 * - Errors: Returns plain text error messages
 *
 * @param {Object} response - MCP response object
 * @returns {*} Parsed response data or empty array on error
 */
export function parseMCPResponse(response) {
  // Handle missing or malformed response
  if (!response?.content || !Array.isArray(response.content)) {
    console.debug('MCP response missing content array');
    return [];
  }

  // GitHub MCP: Check for resource type in multi-part responses
  for (const item of response.content) {
    if (item.type === 'resource' && item.resource) {
      return {
        content: item.resource.text || '',
        uri: item.resource.uri,
        mimeType: item.resource.mimeType,
        encoding: 'utf8'
      };
    }
  }

  // GitLab MCP: Single-element text/data responses (existing logic)
  const content = response.content[0];

  // Handle different content types
  if (!content.text && !content.data) {
    console.debug('MCP response content missing text or data field:', content);
    return [];
  }

  const rawData = content.text || content.data;

  // If already an object, return as-is (GitHub MCP pattern)
  if (typeof rawData === 'object' && rawData !== null) {
    console.debug('MCP response already parsed as object');
    return rawData;
  }

  // If it's a string, attempt to parse as JSON
  if (typeof rawData === 'string') {
    // Check if it looks like an error message (not JSON)
    if (!rawData.trim().startsWith('{') && !rawData.trim().startsWith('[')) {
      console.debug('MCP response appears to be plain text:', rawData);
      // Return as error object for better handling upstream
      return { error: rawData, isPlainText: true };
    }

    try {
      const parsed = JSON.parse(rawData);
      console.debug('MCP response successfully parsed from JSON string');
      return parsed;
    } catch (error) {
      console.error('Failed to parse MCP response as JSON:', {
        error: error.message,
        responsePreview: rawData.substring(0, 100) + (rawData.length > 100 ? '...' : ''),
        fullResponse: rawData
      });
      // Return structured error for upstream handling
      return { error: `JSON parse failed: ${error.message}`, originalText: rawData };
    }
  }

  // Unexpected data type
  console.error('MCP response has unexpected type:', typeof rawData);
  return [];
}

/**
 * Creates a standardized MCP transport for GitHub using Docker
 *
 * @param {Object} config - Configuration object
 * @param {string} config.token - GitHub personal access token (required)
 * @param {Array<string>} [config.repositories] - List of repositories to access (optional)
 * @returns {StdioClientTransport} Configured transport instance
 * @throws {Error} If required configuration is missing
 */
export function createGitHubTransport(config) {
  if (!config.token) {
    throw new Error('GitHub token is required for MCP transport');
  }

  // Use Docker to run the GitHub MCP server
  // This approach provides isolation and consistency
  return new StdioClientTransport({
    command: 'docker',
    args: [
      'run',
      '-i',
      '--rm',
      '-e',
      `GITHUB_PERSONAL_ACCESS_TOKEN=${config.token}`,
      'ghcr.io/github/github-mcp-server'
    ],
    env: {
      ...process.env
    }
  });
}

/**
 * Creates and connects a GitHub MCP client
 * Combines transport and client creation with connection handling
 *
 * @param {Object} config - Configuration object
 * @param {string} config.token - GitHub personal access token
 * @param {Array<string>} [config.repositories] - List of repositories to access
 * @returns {Promise<{client: Client, transport: StdioClientTransport}>} Connected MCP client and transport
 * @throws {Error} If connection fails
 */
export async function createConnectedGitHubClient(config) {
  const transport = createGitHubTransport(config);
  const client = createMCPClient();

  try {
    await client.connect(transport);
    // Return both client and transport for proper cleanup
    return { client, transport };
  } catch (error) {
    throw new Error(`Failed to connect GitHub MCP client: ${error.message}`);
  }
}

// Future platform support stubs (following Open/Closed Principle)
// Bitbucket can be implemented when needed without modifying existing code

