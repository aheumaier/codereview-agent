import { jest } from '@jest/globals';
import Context from '../../app/context.js';

// Mock MCP utils module
jest.mock('../../app/mcp-utils.js', () => ({
  createConnectedGitLabClient: jest.fn(),
  createConnectedGitHubClient: jest.fn(),
  safeCloseClient: jest.fn(),
  parseMCPResponse: jest.fn()
}));

describe('Context Module', () => {
  let context;
  let mockClient;
  let mcpUtils;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Get the mocked utils
    mcpUtils = await import('../../app/mcp-utils.js');

    // Setup mock client
    mockClient = {
      request: jest.fn(),
      callTool: jest.fn()
    };

    mcpUtils.createConnectedGitLabClient.mockResolvedValue(mockClient);
    mcpUtils.parseMCPResponse.mockImplementation((response) => {
      if (!response?.content?.[0]?.text) return [];
      const text = response.content[0].text;
      return typeof text === 'string' ? JSON.parse(text) : text;
    });

    // Create fresh instance
    context = new Context();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('buildContext', () => {
    const mockPR = {
      platform: 'gitlab',
      id: '123',
      iid: '10',
      project_id: 'project/repo',
      title: 'Test PR',
      description: 'Test description',
      source_branch: 'feature',
      target_branch: 'main'
    };

    const mockConfig = {
      platforms: {
        gitlab: {
          enabled: true,
          token: 'test-token',
          url: 'https://gitlab.com/api/v4'
        }
      },
      review: {
        contextLines: 10,
        maxFilesPerPR: 50,
        maxLinesPerFile: 1000
      }
    };

    it('should build context with PR diff', async () => {
      const mockDiff = [
        {
          old_path: 'src/app.js',
          new_path: 'src/app.js',
          diff: '@@ -1,3 +1,3 @@\n-old line\n+new line\ncontext line'
        }
      ];

      mockClient.callTool.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify(mockDiff)
        }]
      });

      const prContext = await context.buildContext(mockPR, mockConfig);

      expect(prContext).toMatchObject({
        pr: mockPR,
        diff: mockDiff,
        files: expect.any(Array),
        stats: expect.any(Object)
      });
    });

    it('should calculate diff statistics', async () => {
      const mockDiff = [
        {
          old_path: 'src/app.js',
          new_path: 'src/app.js',
          diff: '@@ -1,3 +1,4 @@\n-old line\n+new line 1\n+new line 2\ncontext'
        },
        {
          old_path: 'src/utils.js',
          new_path: 'src/utils.js',
          diff: '@@ -10,2 +10,1 @@\n-removed line\n-another removed\n+replaced'
        }
      ];

      mockClient.callTool.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify(mockDiff)
        }]
      });

      const prContext = await context.buildContext(mockPR, mockConfig);

      expect(prContext.stats).toEqual({
        filesChanged: 2,
        additions: 3,
        deletions: 3,
        totalLines: 6
      });
    });

    it('should get file contents when needed', async () => {
      const mockDiff = [
        {
          old_path: 'package.json',
          new_path: 'package.json',
          diff: '@@ -1,3 +1,3 @@\nmodified content'
        }
      ];

      const mockFileContent = {
        name: 'package.json',
        content: '{"name": "test", "version": "1.0.0"}'
      };

      mockClient.callTool
        .mockResolvedValueOnce({ // Diff request
          content: [{
            type: 'text',
            text: JSON.stringify(mockDiff)
          }]
        })
        .mockResolvedValueOnce({ // File content request
          content: [{
            type: 'text',
            text: JSON.stringify(mockFileContent)
          }]
        });

      const prContext = await context.buildContext(mockPR, mockConfig);

      expect(prContext.files).toHaveLength(1);
      expect(prContext.files[0]).toMatchObject({
        path: 'package.json',
        content: expect.stringContaining('version')
      });
    });

    it('should limit files and lines per config', async () => {
      // Create many file diffs
      const mockDiff = Array.from({ length: 100 }, (_, i) => ({
        old_path: `src/file${i}.js`,
        new_path: `src/file${i}.js`,
        diff: '@@ -1,1 +1,1 @@\n-old\n+new'
      }));

      mockClient.callTool.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify(mockDiff)
        }]
      });

      const prContext = await context.buildContext(mockPR, mockConfig);

      // Should respect maxFilesPerPR limit
      expect(prContext.diff.length).toBeLessThanOrEqual(mockConfig.review.maxFilesPerPR);
    });

    it('should handle MCP errors gracefully', async () => {
      mockClient.callTool.mockRejectedValue(new Error('MCP error'));

      const prContext = await context.buildContext(mockPR, mockConfig);

      expect(prContext).toMatchObject({
        pr: mockPR,
        diff: [],
        files: [],
        stats: {
          filesChanged: 0,
          additions: 0,
          deletions: 0,
          totalLines: 0
        },
        error: 'Failed to get PR context: MCP error'
      });
    });

    it('should extract context lines around changes', async () => {
      const mockDiff = [
        {
          old_path: 'src/app.js',
          new_path: 'src/app.js',
          diff: [
            '@@ -10,5 +10,5 @@',
            ' context before',
            ' more context',
            '-removed line',
            '+added line',
            ' context after'
          ].join('\n')
        }
      ];

      mockClient.callTool.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify(mockDiff)
        }]
      });

      const prContext = await context.buildContext(mockPR, mockConfig);

      expect(prContext.diff[0].diff).toContain('context before');
      expect(prContext.diff[0].diff).toContain('context after');
    });
  });

  describe('Platform-specific context building', () => {
    it('should use shared MCP utility with correct configuration', async () => {
      const pr = {
        platform: 'gitlab',
        id: '123',
        iid: '10',
        project_id: 'project/repo'
      };

      const config = {
        platforms: {
          gitlab: {
            enabled: true,
            token: 'gitlab-test-token',
            url: 'https://gitlab.example.com/api/v4',
            projectId: 'config/project'
          }
        },
        review: {
          contextLines: 10
        }
      };

      mockClient.callTool.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify([])
        }]
      });

      await context.buildContext(pr, config);

      // Verify createConnectedGitLabClient was called with correct config
      expect(mcpUtils.createConnectedGitLabClient).toHaveBeenCalledWith({
        token: 'gitlab-test-token',
        url: 'https://gitlab.example.com/api/v4',
        projectId: 'config/project', // Should prefer config projectId
        readOnly: false
      });

      // Verify cleanup was called
      expect(mcpUtils.safeCloseClient).toHaveBeenCalledWith(mockClient, 'GitLab context building');
    });

    it('should use GitLab-specific MCP tools', async () => {
      const pr = {
        platform: 'gitlab',
        id: '123',
        iid: '10',
        project_id: 'project/repo'
      };

      const config = {
        platforms: {
          gitlab: {
            enabled: true,
            token: 'test-token',
            url: 'https://gitlab.com/api/v4'
          }
        },
        review: {
          contextLines: 10
        }
      };

      mockClient.callTool.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify([])
        }]
      });

      await context.buildContext(pr, config);

      expect(mockClient.callTool).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'get_merge_request_diffs',
          arguments: expect.objectContaining({
            project_id: 'project/repo',
            merge_request_iid: '10'
          })
        })
      );
    });

    it('should handle GitHub context (stub)', async () => {
      const pr = {
        platform: 'github',
        id: '123'
      };

      const config = {
        platforms: {
          github: {
            enabled: true
          }
        },
        review: {}
      };

      const prContext = await context.buildContext(pr, config);

      expect(prContext.diff).toEqual([]);
      expect(prContext.error).toContain('not implemented');
    });

    it('should handle Bitbucket context (stub)', async () => {
      const pr = {
        platform: 'bitbucket',
        id: '123'
      };

      const config = {
        platforms: {
          bitbucket: {
            enabled: true
          }
        },
        review: {}
      };

      const prContext = await context.buildContext(pr, config);

      expect(prContext.diff).toEqual([]);
      expect(prContext.error).toContain('not implemented');
    });
  });

  describe('File type detection', () => {
    it('should identify important files', async () => {
      const mockDiff = [
        {
          old_path: 'package.json',
          new_path: 'package.json',
          diff: '@@ -1,1 +1,1 @@\nchange'
        },
        {
          old_path: '.env',
          new_path: '.env',
          diff: '@@ -1,1 +1,1 @@\nchange'
        },
        {
          old_path: 'Dockerfile',
          new_path: 'Dockerfile',
          diff: '@@ -1,1 +1,1 @@\nchange'
        }
      ];

      mockClient.callTool.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify(mockDiff)
        }]
      });

      const pr = {
        platform: 'gitlab',
        id: '123',
        iid: '10',
        project_id: 'project/repo'
      };

      const config = {
        platforms: {
          gitlab: {
            enabled: true,
            token: 'test-token',
            url: 'https://gitlab.com/api/v4'
          }
        },
        review: {}
      };

      const prContext = await context.buildContext(pr, config);

      const fileTypes = prContext.files.map(f => f.type);
      expect(fileTypes).toContain('config');
      expect(fileTypes).toContain('sensitive');
      expect(fileTypes).toContain('docker');
    });
  });

  describe('GitHub specific context', () => {
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

    const mockGitHubPR = {
      platform: 'github',
      id: '42',
      repository: 'owner/repo',
      title: 'GitHub PR',
      source_branch: 'feature',
      target_branch: 'main',
      _raw: {
        head: { sha: 'abc123' },
        base: { sha: 'def456' }
      }
    };

    const mockGitHubConfig = {
      platforms: {
        github: {
          enabled: true,
          token: 'github-token'
        }
      },
      review: {
        maxFilesPerPR: 50,
        maxLinesPerFile: 1000
      }
    };

    it('should build GitHub context with PR files and diffs', async () => {
      // Mock PR details
      mockGitHubClient.request
        .mockResolvedValueOnce({
          content: [{
            type: 'text',
            text: JSON.stringify({
              head: { sha: 'abc123' },
              base: { sha: 'def456' }
            })
          }]
        })
        // Mock changed files
        .mockResolvedValueOnce({
          content: [{
            type: 'text',
            text: JSON.stringify([
              {
                filename: 'src/app.js',
                status: 'modified',
                additions: 5,
                deletions: 3,
                changes: 8,
                patch: '@@ -1,3 +1,5 @@\n-old line\n+new line\n+another new line'
              }
            ])
          }]
        })
        // Mock file content
        .mockResolvedValueOnce({
          content: [{
            type: 'text',
            text: 'file content here'
          }]
        });

      const prContext = await context.buildContext(mockGitHubPR, mockGitHubConfig);

      expect(prContext).toMatchObject({
        pr: expect.objectContaining({
          platform: 'github',
          owner: 'owner',
          repo: 'repo',
          number: 42
        }),
        diff: expect.arrayContaining([
          expect.objectContaining({
            new_path: 'src/app.js',
            additions: 5,
            deletions: 3
          })
        ]),
        files: expect.any(Array),
        stats: expect.objectContaining({
          filesChanged: 1,
          additions: 5,
          deletions: 3
        })
      });

      // Verify correct MCP tools were called
      expect(mockGitHubClient.request).toHaveBeenCalledWith({
        method: 'tools/call',
        params: {
          name: 'get_pull_request',
          arguments: {
            owner: 'owner',
            repo: 'repo',
            pull_number: 42
          }
        }
      });

      expect(mockGitHubClient.request).toHaveBeenCalledWith({
        method: 'tools/call',
        params: {
          name: 'get_pull_request_files',
          arguments: {
            owner: 'owner',
            repo: 'repo',
            pull_number: 42
          }
        }
      });
    });

    it('should handle GitHub file status types correctly', async () => {
      mockGitHubClient.request
        .mockResolvedValueOnce({
          content: [{
            type: 'text',
            text: JSON.stringify({})
          }]
        })
        .mockResolvedValueOnce({
          content: [{
            type: 'text',
            text: JSON.stringify([
              {
                filename: 'new.js',
                status: 'added',
                patch: '+new file'
              },
              {
                filename: 'deleted.js',
                status: 'removed',
                patch: '-old file'
              },
              {
                filename: 'renamed.js',
                previous_filename: 'old.js',
                status: 'renamed',
                patch: 'rename diff'
              }
            ])
          }]
        });

      const prContext = await context.buildContext(mockGitHubPR, mockGitHubConfig);

      expect(prContext.diff).toEqual(expect.arrayContaining([
        expect.objectContaining({
          new_path: 'new.js',
          new_file: true,
          deleted_file: false
        }),
        expect.objectContaining({
          new_path: 'deleted.js',
          deleted_file: true,
          new_file: false
        }),
        expect.objectContaining({
          new_path: 'renamed.js',
          old_path: 'old.js',
          renamed_file: true
        })
      ]));
    });

    it('should close GitHub transport properly', async () => {
      mockGitHubClient.request.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify([])
        }]
      });

      await context.buildContext(mockGitHubPR, mockGitHubConfig);

      expect(mcpUtils.safeCloseClient).toHaveBeenCalledWith(mockGitHubClient, 'GitHub context building');
      expect(mockTransport.close).toHaveBeenCalled();
    });

    it('should handle GitHub API errors gracefully', async () => {
      mockGitHubClient.request.mockRejectedValue(new Error('GitHub API error'));

      const prContext = await context.buildContext(mockGitHubPR, mockGitHubConfig);

      expect(prContext).toMatchObject({
        pr: mockGitHubPR,
        error: expect.stringContaining('Failed to get GitHub PR context')
      });
    });
  });
});