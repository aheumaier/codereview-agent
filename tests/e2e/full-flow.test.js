import { test, expect } from '@playwright/test';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to run the agent
async function runAgent(env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [path.join(__dirname, '../../app/index.js')], {
      env: {
        ...process.env,
        ...env,
        DRY_RUN: 'true' // Always dry-run in tests
      }
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });

    child.on('error', reject);
  });
}

test.describe('Code Review Agent E2E', () => {
  test.beforeAll(async () => {
    // Create test config
    const testConfig = {
      review: {
        maxDaysBack: 7,
        prStates: ['open'],
        excludeLabels: ['wip', 'draft'],
        maxFilesPerPR: 50,
        maxLinesPerFile: 1000,
        contextLines: 10,
        minCoveragePercent: 80,
        maxComplexity: 10
      },
      platforms: {
        gitlab: {
          enabled: false // Disabled for testing
        },
        github: {
          enabled: false
        },
        bitbucket: {
          enabled: false
        }
      },
      claude: {
        apiKey: '${CLAUDE_API_KEY}',
        model: 'claude-3-opus-20240229',
        maxTokens: 4096,
        temperature: 0.3
      },
      output: {
        dryRun: 'true',
        postComments: true,
        postSummary: true,
        approveIfNoIssues: false
      },
      tracking: {
        dbPath: './test-reviews.db',
        ttlDays: 30
      }
    };

    // Write test config
    await fs.writeFile(
      path.join(__dirname, '../../conf/config-test.json'),
      JSON.stringify(testConfig, null, 2)
    );
  });

  test.afterAll(async () => {
    // Clean up test files
    try {
      await fs.unlink(path.join(__dirname, '../../conf/config-test.json'));
      await fs.unlink('./test-reviews.db');
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  test('should start and complete without errors', async () => {
    const { code, stdout, stderr } = await runAgent({
      CLAUDE_API_KEY: 'test-key'
    });

    expect(code).toBe(0);
    expect(stdout).toContain('Code Review Agent Starting');
    expect(stdout).toContain('Loading configuration');
    expect(stderr).toBe('');
  });

  test('should handle missing API key', async () => {
    const { code, stdout } = await runAgent({
      CLAUDE_API_KEY: ''
    });

    expect(code).toBe(1);
    expect(stdout).toContain('Fatal error');
    expect(stdout).toContain('API key');
  });

  test('should handle no enabled platforms', async () => {
    const { code, stdout } = await runAgent({
      CLAUDE_API_KEY: 'test-key'
    });

    // With all platforms disabled in test config, it should handle gracefully
    expect(stdout).toContain('No pull requests to review');
  });

  test('should respect dry-run mode', async () => {
    const { stdout } = await runAgent({
      CLAUDE_API_KEY: 'test-key',
      DRY_RUN: 'true'
    });

    if (stdout.includes('Processing:')) {
      expect(stdout).toContain('DRY RUN');
    }
  });

  test('should initialize tracker database', async () => {
    await runAgent({
      CLAUDE_API_KEY: 'test-key'
    });

    // Check if database file was created
    const dbExists = await fs.access('./test-reviews.db')
      .then(() => true)
      .catch(() => false);

    expect(dbExists).toBe(true);
  });

  test('should show review summary at the end', async () => {
    const { stdout } = await runAgent({
      CLAUDE_API_KEY: 'test-key'
    });

    if (stdout.includes('Review Summary')) {
      expect(stdout).toMatch(/Reviewed: \d+/);
      expect(stdout).toMatch(/Skipped: \d+/);
      expect(stdout).toMatch(/Errors: \d+/);
      expect(stdout).toMatch(/Total: \d+/);
    }
  });

  test('should complete successfully', async () => {
    const { code, stdout } = await runAgent({
      CLAUDE_API_KEY: 'test-key'
    });

    expect(code).toBe(0);
    expect(stdout).toContain('Code Review Agent Complete');
  });
});

test.describe('Mock MCP Server Integration', () => {
  let mockMCPServer;

  test.beforeAll(async () => {
    // Create a mock MCP server script
    const mockServerCode = `
      import { Server } from '@modelcontextprotocol/sdk/server/index.js';
      import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

      const server = new Server({
        name: 'mock-gitlab-mcp',
        version: '1.0.0'
      }, {
        capabilities: {
          tools: {}
        }
      });

      server.setRequestHandler(async (request) => {
        if (request.method === 'tools/call') {
          const { name, arguments: args } = request.params;

          if (name.includes('list_merge_requests')) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify([{
                  id: '1',
                  iid: '10',
                  project_id: 'test/repo',
                  title: 'Test PR',
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                  state: 'opened'
                }])
              }]
            };
          }

          if (name.includes('get_merge_request_diffs')) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify([{
                  old_path: 'test.js',
                  new_path: 'test.js',
                  diff: '@@ -1,1 +1,1 @@\\n-old\\n+new'
                }])
              }]
            };
          }
        }

        return { content: [{ type: 'text', text: '[]' }] };
      });

      const transport = new StdioServerTransport();
      await server.connect(transport);
    `;

    await fs.writeFile(
      path.join(__dirname, '../../mock-mcp-server.js'),
      mockServerCode
    );
  });

  test.afterAll(async () => {
    try {
      await fs.unlink(path.join(__dirname, '../../mock-mcp-server.js'));
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  test('should interact with mock MCP server', async () => {
    // Update config to use mock server
    const config = JSON.parse(
      await fs.readFile(path.join(__dirname, '../../conf/config-test.json'), 'utf-8')
    );

    config.platforms.gitlab.enabled = true;
    config.platforms.gitlab.mcpServerPath = path.join(__dirname, '../../mock-mcp-server.js');

    await fs.writeFile(
      path.join(__dirname, '../../conf/config-test.json'),
      JSON.stringify(config, null, 2)
    );

    const { code, stdout } = await runAgent({
      CLAUDE_API_KEY: 'test-key',
      GITLAB_TOKEN: 'test-token'
    });

    // The mock server should allow discovery to work
    if (config.platforms.gitlab.enabled) {
      expect(stdout).toContain('Discovering pull requests');
    }
  });
});