import { jest } from '@jest/globals';
import Discovery from '../../app/discovery.js';

// Mock MCP utils module
jest.mock('../../app/mcp-utils.js', () => ({
  createConnectedGitLabClient: jest.fn(),
  createConnectedGitHubClient: jest.fn(),
  safeCloseClient: jest.fn(),
  parseMCPResponse: jest.fn()
}));

describe('Discovery Module', () => {
  let discovery;
  let mockClient;
  let mcpUtils;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Get the mocked utils
    mcpUtils = await import('../../app/mcp-utils.js');

    // Setup mock client
    mockClient = {
      callTool: jest.fn()
    };

    mcpUtils.createConnectedGitLabClient.mockResolvedValue(mockClient);
    mcpUtils.parseMCPResponse.mockImplementation((response) => {
      if (!response?.content?.[0]?.text) return [];
      const text = response.content[0].text;
      return typeof text === 'string' ? JSON.parse(text) : text;
    });

    // Create fresh instance
    discovery = new Discovery();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('discoverPRs', () => {
    const mockConfig = {
      platforms: {
        gitlab: {
          enabled: true,
          token: 'test-token',
          url: 'https://gitlab.com/api/v4',
          projectId: 'test/project'
        },
        github: {
          enabled: false
        },
        bitbucket: {
          enabled: false
        }
      },
      review: {
        maxDaysBack: 7,
        prStates: ['open'],
        excludeLabels: ['wip', 'draft']
      }
    };

    it('should discover PRs from enabled platforms', async () => {
      const mockPRs = [
        {
          id: '123',
          title: 'Test PR',
          repository: 'project/repo',
          state: 'open',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      ];

      mockClient.callTool.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify(mockPRs)
        }]
      });

      const prs = await discovery.discoverPRs(mockConfig);

      expect(prs).toHaveLength(1);
      expect(prs[0]).toMatchObject({
        platform: 'gitlab',
        id: '123',
        title: 'Test PR'
      });
    });

    it('should filter PRs by date range', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 10);

      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 2);

      const mockPRs = [
        {
          id: '123',
          title: 'Old PR',
          created_at: oldDate.toISOString()
        },
        {
          id: '456',
          title: 'Recent PR',
          created_at: recentDate.toISOString()
        }
      ];

      mockClient.callTool.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify(mockPRs)
        }]
      });

      const prs = await discovery.discoverPRs(mockConfig);

      expect(prs).toHaveLength(1);
      expect(prs[0].id).toBe('456');
    });

    it('should filter PRs with excluded labels', async () => {
      const mockPRs = [
        {
          id: '123',
          title: 'WIP PR',
          labels: ['wip', 'feature'],
          created_at: new Date().toISOString()
        },
        {
          id: '456',
          title: 'Ready PR',
          labels: ['feature'],
          created_at: new Date().toISOString()
        }
      ];

      mockClient.callTool.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify(mockPRs)
        }]
      });

      const prs = await discovery.discoverPRs(mockConfig);

      expect(prs).toHaveLength(1);
      expect(prs[0].id).toBe('456');
    });

    it('should handle multiple platforms', async () => {
      const multiPlatformConfig = {
        ...mockConfig,
        platforms: {
          ...mockConfig.platforms,
          github: {
            enabled: true,
            mcpServerPath: '/path/to/github-mcp',
            token: 'github-token'
          }
        }
      };

      mockClient.callTool.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify([{ id: '1', created_at: new Date().toISOString() }])
        }]
      });

      const prs = await discovery.discoverPRs(multiPlatformConfig);

      // Should call MCP only for GitLab (GitHub is not implemented)
      expect(mcpUtils.createConnectedGitLabClient).toHaveBeenCalledTimes(1);
      expect(prs).toHaveLength(1); // Only GitLab PR returned since GitHub is not implemented
    });

    it('should handle MCP connection errors gracefully', async () => {
      mcpUtils.createConnectedGitLabClient.mockRejectedValue(new Error('Connection failed'));

      const prs = await discovery.discoverPRs(mockConfig);

      expect(prs).toEqual([]);
    });

    it('should handle empty PR lists', async () => {
      mockClient.callTool.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify([])
        }]
      });

      const prs = await discovery.discoverPRs(mockConfig);

      expect(prs).toEqual([]);
    });

    it('should properly close MCP connections', async () => {
      mockClient.callTool.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify([])
        }]
      });

      await discovery.discoverPRs(mockConfig);

      expect(mcpUtils.safeCloseClient).toHaveBeenCalledWith(mockClient, 'GitLab discovery');
    });
  });

  describe('GitLab specific discovery', () => {
    it('should use correct MCP tool for GitLab', async () => {
      const config = {
        platforms: {
          gitlab: {
            enabled: true,
            token: 'test-token',
            url: 'https://gitlab.com/api/v4',
            projectId: 'project/repo'
          }
        },
        review: {
          maxDaysBack: 7,
          prStates: ['open']
        }
      };

      mockClient.callTool.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify([])
        }]
      });

      await discovery.discoverPRs(config);

      expect(mockClient.callTool).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'list_merge_requests',
          arguments: expect.objectContaining({
            project_id: 'project/repo',
            state: 'opened'
          })
        })
      );
    });
  });

  describe('GitHub specific discovery', () => {
    let mockGitHubClient;
    let mockTransport;

    beforeEach(() => {
      mockGitHubClient = {
        request: jest.fn(),
        close: jest.fn()
      };
      mockTransport = {
        close: jest.fn()
      };

      mcpUtils.createConnectedGitHubClient.mockResolvedValue({
        client: mockGitHubClient,
        transport: mockTransport
      });
    });

    it('should discover GitHub PRs with configured repositories', async () => {
      const config = {
        platforms: {
          gitlab: { enabled: false },
          github: {
            enabled: true,
            token: 'github-token',
            repositories: ['owner/repo1', 'owner/repo2']
          },
          bitbucket: { enabled: false }
        },
        review: {
          maxDaysBack: 7,
          prStates: ['open'],
          excludeLabels: ['wip', 'draft']
        }
      };

      const mockPRs = [
        {
          number: 42,
          title: 'GitHub PR',
          state: 'open',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          user: { login: 'author' },
          head: { ref: 'feature' },
          base: { ref: 'main' },
          labels: []
        }
      ];

      mockGitHubClient.request.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify(mockPRs)
        }]
      });

      const prs = await discovery.discoverPRs(config);

      expect(prs).toHaveLength(2); // Called for 2 repos
      expect(prs[0]).toMatchObject({
        platform: 'github',
        id: '42',
        title: 'GitHub PR',
        repository: 'owner/repo1'
      });

      expect(mockGitHubClient.request).toHaveBeenCalledWith({
        method: 'tools/call',
        params: {
          name: 'list_pull_requests',
          arguments: expect.objectContaining({
            owner: 'owner',
            repo: 'repo1',
            state: 'open'
          })
        }
      });
    });

    it('should filter GitHub PRs by labels and draft status', async () => {
      const config = {
        platforms: {
          gitlab: { enabled: false },
          github: {
            enabled: true,
            token: 'github-token',
            repositories: ['owner/repo']
          },
          bitbucket: { enabled: false }
        },
        review: {
          maxDaysBack: 7,
          prStates: ['open'],
          excludeLabels: ['wip', 'draft']
        }
      };

      const mockPRs = [
        {
          number: 1,
          title: 'Draft PR',
          draft: true,
          created_at: new Date().toISOString(),
          labels: []
        },
        {
          number: 2,
          title: 'WIP PR',
          draft: false,
          created_at: new Date().toISOString(),
          labels: [{ name: 'wip' }]
        },
        {
          number: 3,
          title: 'Valid PR',
          draft: false,
          created_at: new Date().toISOString(),
          labels: [{ name: 'feature' }]
        }
      ];

      mockGitHubClient.request.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify(mockPRs)
        }]
      });

      const prs = await discovery.discoverPRs(config);

      expect(prs).toHaveLength(1);
      expect(prs[0]).toMatchObject({
        platform: 'github',
        id: '3',
        title: 'Valid PR'
      });
    });

    it('should handle GitHub API errors gracefully', async () => {
      const config = {
        platforms: {
          gitlab: { enabled: false },
          github: {
            enabled: true,
            token: 'github-token',
            repositories: ['owner/repo']
          },
          bitbucket: { enabled: false }
        },
        review: {
          maxDaysBack: 7,
          prStates: ['open']
        }
      };

      mockGitHubClient.request.mockRejectedValue(new Error('API rate limit'));

      const prs = await discovery.discoverPRs(config);

      expect(prs).toEqual([]);
      expect(mcpUtils.safeCloseClient).toHaveBeenCalled();
      expect(mockTransport.close).toHaveBeenCalled();
    });

    it('should close GitHub transport properly', async () => {
      const config = {
        platforms: {
          gitlab: { enabled: false },
          github: {
            enabled: true,
            token: 'github-token',
            repositories: []
          },
          bitbucket: { enabled: false }
        },
        review: {
          maxDaysBack: 7,
          prStates: ['open']
        }
      };

      mockGitHubClient.request.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify([])
        }]
      });

      await discovery.discoverPRs(config);

      expect(mcpUtils.safeCloseClient).toHaveBeenCalledWith(mockGitHubClient, 'GitHub discovery');
      expect(mockTransport.close).toHaveBeenCalled();
    });
  });

  describe('Bitbucket stub', () => {
    it('should return empty array for Bitbucket (stub)', async () => {
      const config = {
        platforms: {
          gitlab: { enabled: false },
          github: { enabled: false },
          bitbucket: { enabled: true }
        },
        review: {
          maxDaysBack: 7,
          prStates: ['open']
        }
      };

      const prs = await discovery.discoverPRs(config);

      expect(prs).toEqual([]);
    });
  });
});