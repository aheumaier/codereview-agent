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
 * Handles both string and object responses
 *
 * @param {Object} response - MCP response object
 * @returns {*} Parsed response data or empty array on error
 */
export function parseMCPResponse(response) {
  if (!response?.content?.[0]?.text) {
    return [];
  }

  try {
    const text = response.content[0].text;
    return typeof text === 'string' ? JSON.parse(text) : text;
  } catch (error) {
    console.error('Failed to parse MCP response:', error);
    return [];
  }
}

// Future platform support stubs (following Open/Closed Principle)
// These can be implemented when needed without modifying existing code

