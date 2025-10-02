import { jest } from '@jest/globals';

// Mock MCP SDK modules before importing the module under test
jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: jest.fn()
}));

jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: jest.fn()
}));

describe('MCP Utils Module', () => {
  let mcpUtils;
  let Client;
  let StdioClientTransport;
  let mockClient;
  let mockTransport;

  beforeEach(async () => {
    jest.resetModules();
    jest.clearAllMocks();

    // Get the mocked constructors
    const clientModule = await import('@modelcontextprotocol/sdk/client/index.js');
    const transportModule = await import('@modelcontextprotocol/sdk/client/stdio.js');

    Client = clientModule.Client;
    StdioClientTransport = transportModule.StdioClientTransport;

    // Setup mock implementations
    mockClient = {
      connect: jest.fn(),
      close: jest.fn()
    };

    mockTransport = {};

    Client.mockImplementation(() => mockClient);
    StdioClientTransport.mockImplementation(() => mockTransport);

    // Import the module under test
    mcpUtils = await import('../../app/mcp-utils.js');
  });

  describe('createGitLabTransport', () => {
    it('should create transport with all required environment variables', () => {
      const config = {
        token: 'test-token',
        url: 'https://gitlab.com/api/v4',
        projectId: 'project/repo',
        readOnly: false
      };

      const transport = mcpUtils.createGitLabTransport(config);

      expect(StdioClientTransport).toHaveBeenCalledWith({
        command: 'npx',
        args: ['-y', '@zereight/mcp-gitlab'],
        env: expect.objectContaining({
          GITLAB_PERSONAL_ACCESS_TOKEN: 'test-token',
          GITLAB_API_URL: 'https://gitlab.com/api/v4',
          GITLAB_PROJECT_ID: 'project/repo',
          GITLAB_READ_ONLY_MODE: 'false'
        })
      });

      expect(transport).toBe(mockTransport);
    });

    it('should handle missing projectId gracefully', () => {
      const config = {
        token: 'test-token',
        url: 'https://gitlab.com/api/v4'
      };

      mcpUtils.createGitLabTransport(config);

      const call = StdioClientTransport.mock.calls[0][0];
      expect(call.env.GITLAB_PROJECT_ID).toBe('');
    });

    it('should set read-only mode when specified', () => {
      const config = {
        token: 'test-token',
        url: 'https://gitlab.com/api/v4',
        readOnly: true
      };

      mcpUtils.createGitLabTransport(config);

      const call = StdioClientTransport.mock.calls[0][0];
      expect(call.env.GITLAB_READ_ONLY_MODE).toBe('true');
    });

    it('should throw error when token is missing', () => {
      const config = {
        url: 'https://gitlab.com/api/v4'
      };

      expect(() => mcpUtils.createGitLabTransport(config))
        .toThrow('GitLab token is required for MCP transport');
    });

    it('should throw error when URL is missing', () => {
      const config = {
        token: 'test-token'
      };

      expect(() => mcpUtils.createGitLabTransport(config))
        .toThrow('GitLab API URL is required for MCP transport');
    });

    it('should preserve existing process.env variables', () => {
      process.env.CUSTOM_VAR = 'custom-value';

      const config = {
        token: 'test-token',
        url: 'https://gitlab.com/api/v4'
      };

      mcpUtils.createGitLabTransport(config);

      const call = StdioClientTransport.mock.calls[0][0];
      expect(call.env.CUSTOM_VAR).toBe('custom-value');
    });
  });

  describe('createMCPClient', () => {
    it('should create client with default values', () => {
      const client = mcpUtils.createMCPClient();

      expect(Client).toHaveBeenCalledWith(
        {
          name: 'codereview-agent',
          version: '1.0.0'
        },
        {
          capabilities: {}
        }
      );

      expect(client).toBe(mockClient);
    });

    it('should create client with custom values', () => {
      const client = mcpUtils.createMCPClient('custom-name', '2.0.0');

      expect(Client).toHaveBeenCalledWith(
        {
          name: 'custom-name',
          version: '2.0.0'
        },
        {
          capabilities: {}
        }
      );
    });
  });

  describe('createConnectedGitLabClient', () => {
    it('should create and connect client successfully', async () => {
      const config = {
        token: 'test-token',
        url: 'https://gitlab.com/api/v4',
        projectId: 'project/repo'
      };

      mockClient.connect.mockResolvedValue();

      const client = await mcpUtils.createConnectedGitLabClient(config);

      expect(StdioClientTransport).toHaveBeenCalled();
      expect(Client).toHaveBeenCalled();
      expect(mockClient.connect).toHaveBeenCalledWith(mockTransport);
      expect(client).toBe(mockClient);
    });

    it('should throw error when connection fails', async () => {
      const config = {
        token: 'test-token',
        url: 'https://gitlab.com/api/v4'
      };

      mockClient.connect.mockRejectedValue(new Error('Connection failed'));

      await expect(mcpUtils.createConnectedGitLabClient(config))
        .rejects.toThrow('Failed to connect GitLab MCP client: Connection failed');
    });
  });

  describe('safeCloseClient', () => {
    it('should close client successfully', async () => {
      mockClient.close.mockResolvedValue();

      await mcpUtils.safeCloseClient(mockClient, 'test context');

      expect(mockClient.close).toHaveBeenCalled();
    });

    it('should handle close errors gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      mockClient.close.mockRejectedValue(new Error('Close failed'));

      await mcpUtils.safeCloseClient(mockClient, 'test context');

      expect(consoleSpy).toHaveBeenCalledWith(
        'Warning: MCP client cleanup failed (test context):',
        'Close failed'
      );

      consoleSpy.mockRestore();
    });

    it('should handle null client', async () => {
      await mcpUtils.safeCloseClient(null);

      expect(mockClient.close).not.toHaveBeenCalled();
    });

    it('should handle undefined client', async () => {
      await mcpUtils.safeCloseClient(undefined);

      expect(mockClient.close).not.toHaveBeenCalled();
    });
  });

  describe('parseMCPResponse', () => {
    it('should parse JSON string response', () => {
      const response = {
        content: [{
          text: '{"id": 123, "title": "Test PR"}'
        }]
      };

      const result = mcpUtils.parseMCPResponse(response);

      expect(result).toEqual({
        id: 123,
        title: 'Test PR'
      });
    });

    it('should return object response as-is', () => {
      const data = { id: 123, title: 'Test PR' };
      const response = {
        content: [{
          text: data
        }]
      };

      const result = mcpUtils.parseMCPResponse(response);

      expect(result).toBe(data);
    });

    it('should return empty array for missing content', () => {
      const response = {};

      const result = mcpUtils.parseMCPResponse(response);

      expect(result).toEqual([]);
    });

    it('should return empty array for invalid JSON', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const response = {
        content: [{
          text: 'invalid json'
        }]
      };

      const result = mcpUtils.parseMCPResponse(response);

      expect(result).toEqual([]);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to parse MCP response:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });

  describe('Future platform stubs', () => {
    it('should throw for GitHub transport (not implemented)', () => {
      expect(() => mcpUtils.createGitHubTransport({}))
        .toThrow('GitHub MCP transport not yet implemented');
    });

    it('should throw for Bitbucket transport (not implemented)', () => {
      expect(() => mcpUtils.createBitbucketTransport({}))
        .toThrow('Bitbucket MCP transport not yet implemented');
    });
  });

  describe('Environment variable consistency', () => {
    it('should use consistent GitLab environment variables across all configs', () => {
      const configs = [
        {
          token: 'token1',
          url: 'https://gitlab1.com/api/v4',
          projectId: 'project1',
          readOnly: false
        },
        {
          token: 'token2',
          url: 'https://gitlab2.com/api/v4',
          projectId: 'project2',
          readOnly: true
        }
      ];

      configs.forEach(config => {
        mcpUtils.createGitLabTransport(config);
      });

      // Verify all calls use the same environment variable names
      StdioClientTransport.mock.calls.forEach((call, index) => {
        const env = call[0].env;

        expect(env).toHaveProperty('GITLAB_PERSONAL_ACCESS_TOKEN');
        expect(env).toHaveProperty('GITLAB_API_URL');
        expect(env).toHaveProperty('GITLAB_PROJECT_ID');
        expect(env).toHaveProperty('GITLAB_READ_ONLY_MODE');

        // Verify no old-style variables are present
        expect(env.GITLAB_TOKEN).toBeUndefined();
        expect(env.GITLAB_URL).toBeUndefined();

        // Verify values match the config
        expect(env.GITLAB_PERSONAL_ACCESS_TOKEN).toBe(configs[index].token);
        expect(env.GITLAB_API_URL).toBe(configs[index].url);
        expect(env.GITLAB_PROJECT_ID).toBe(configs[index].projectId || '');
        expect(env.GITLAB_READ_ONLY_MODE).toBe(configs[index].readOnly ? 'true' : 'false');
      });
    });

    it('should use npx pattern consistently', () => {
      const config = {
        token: 'test-token',
        url: 'https://gitlab.com/api/v4'
      };

      mcpUtils.createGitLabTransport(config);

      const call = StdioClientTransport.mock.calls[0][0];

      expect(call.command).toBe('npx');
      expect(call.args).toEqual(['-y', '@zereight/mcp-gitlab']);

      // Should NOT use local server path
      expect(call.command).not.toContain('node');
      expect(call.command).not.toContain('.js');
      expect(call.args).not.toContain('server.js');
    });
  });
});