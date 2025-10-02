import { jest } from '@jest/globals';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Mock MCP SDK
jest.mock('@modelcontextprotocol/sdk/client/index.js');
jest.mock('@modelcontextprotocol/sdk/client/stdio.js');

describe('Output Module', () => {
  let output;
  let mockClient;
  let mockTransport;

  beforeEach(async () => {
    jest.resetModules();

    // Setup mock client
    mockClient = {
      connect: jest.fn(),
      request: jest.fn(),
      close: jest.fn()
    };

    mockTransport = {};

    Client.mockImplementation(() => mockClient);
    StdioClientTransport.mockImplementation(() => mockTransport);

    const outputModule = await import('../../app/output.js');
    output = outputModule.default;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('postReview', () => {
    const mockPR = {
      platform: 'gitlab',
      id: '123',
      iid: '10',
      project_id: 'project/repo',
      title: 'Test PR'
    };

    const mockReview = {
      summary: 'Good changes overall',
      decision: 'approved',
      comments: [
        {
          file: 'src/app.js',
          line: 10,
          severity: 'minor',
          message: 'Consider using const'
        },
        {
          file: 'src/utils.js',
          line: 25,
          severity: 'major',
          message: 'Potential memory leak'
        }
      ],
      issues: {
        critical: 0,
        major: 1,
        minor: 1
      }
    };

    const mockConfig = {
      platforms: {
        gitlab: {
          enabled: true,
          mcpServerPath: '/path/to/gitlab-mcp'
        }
      },
      output: {
        dryRun: false,
        postComments: true,
        postSummary: true,
        approveIfNoIssues: true
      }
    };

    it('should post review summary and comments', async () => {
      mockClient.request.mockResolvedValue({ success: true });

      await output.postReview(mockPR, mockReview, mockConfig);

      // Should post summary
      expect(mockClient.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'tools/call',
          params: expect.objectContaining({
            name: expect.stringContaining('create_note'),
            arguments: expect.objectContaining({
              body: expect.stringContaining('Good changes overall')
            })
          })
        })
      );

      // Should post inline comments
      expect(mockClient.request).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            arguments: expect.objectContaining({
              body: expect.stringContaining('Consider using const'),
              position: expect.objectContaining({
                new_path: 'src/app.js',
                new_line: 10
              })
            })
          })
        })
      );
    });

    it('should respect dry-run mode', async () => {
      const dryRunConfig = {
        ...mockConfig,
        output: {
          ...mockConfig.output,
          dryRun: true
        }
      };

      const result = await output.postReview(mockPR, mockReview, dryRunConfig);

      expect(mockClient.request).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        posted: false,
        dryRun: true
      });
    });

    it('should format summary with issue counts', async () => {
      const formattedSummary = output.formatSummary(mockReview);

      expect(formattedSummary).toContain('Code Review Summary');
      expect(formattedSummary).toContain('Decision: approved');
      expect(formattedSummary).toContain('Major: 1');
      expect(formattedSummary).toContain('Minor: 1');
      expect(formattedSummary).toContain('Good changes overall');
    });

    it('should approve PR if no critical/major issues', async () => {
      const cleanReview = {
        ...mockReview,
        decision: 'approved',
        comments: [],
        issues: {
          critical: 0,
          major: 0,
          minor: 0
        }
      };

      mockClient.request.mockResolvedValue({ success: true });

      await output.postReview(mockPR, cleanReview, mockConfig);

      // Should call approve endpoint
      expect(mockClient.request).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            name: expect.stringContaining('approve')
          })
        })
      );
    });

    it('should not approve if critical issues exist', async () => {
      const criticalReview = {
        ...mockReview,
        decision: 'changes_requested',
        issues: {
          critical: 1,
          major: 0,
          minor: 0
        }
      };

      await output.postReview(mockPR, criticalReview, mockConfig);

      // Should not call approve endpoint
      expect(mockClient.request).not.toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            name: expect.stringContaining('approve')
          })
        })
      );
    });

    it('should handle posting errors gracefully', async () => {
      mockClient.request.mockRejectedValue(new Error('MCP error'));

      const result = await output.postReview(mockPR, mockReview, mockConfig);

      expect(result).toMatchObject({
        posted: false,
        error: expect.stringContaining('Failed to post review')
      });
    });

    it('should skip comments if postComments is false', async () => {
      const noCommentsConfig = {
        ...mockConfig,
        output: {
          ...mockConfig.output,
          postComments: false
        }
      };

      await output.postReview(mockPR, mockReview, noCommentsConfig);

      // Should only post summary, not individual comments
      const calls = mockClient.request.mock.calls;
      const commentCalls = calls.filter(call =>
        call[0]?.params?.arguments?.position !== undefined
      );

      expect(commentCalls).toHaveLength(0);
    });

    it('should format comments with severity indicators', () => {
      const comment = {
        severity: 'critical',
        message: 'Security issue'
      };

      const formatted = output.formatComment(comment);

      expect(formatted).toContain('🔴');
      expect(formatted).toContain('[CRITICAL]');
      expect(formatted).toContain('Security issue');
    });
  });

  describe('Platform-specific posting', () => {
    it('should use GitLab-specific MCP tools', async () => {
      const pr = {
        platform: 'gitlab',
        id: '123',
        iid: '10',
        project_id: 'project/repo'
      };

      const review = {
        summary: 'Test',
        decision: 'approved',
        comments: []
      };

      const config = {
        platforms: {
          gitlab: {
            enabled: true,
            mcpServerPath: '/path/to/gitlab-mcp'
          }
        },
        output: {
          dryRun: false,
          postSummary: true
        }
      };

      mockClient.request.mockResolvedValue({ success: true });

      await output.postReview(pr, review, config);

      expect(mockClient.request).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            name: expect.stringContaining('gitlab')
          })
        })
      );
    });

    it('should handle GitHub output (stub)', async () => {
      const pr = {
        platform: 'github',
        id: '123'
      };

      const review = {
        summary: 'Test',
        comments: []
      };

      const config = {
        platforms: {
          github: { enabled: true }
        },
        output: { dryRun: false }
      };

      const result = await output.postReview(pr, review, config);

      expect(result.error).toContain('not implemented');
    });

    it('should handle Bitbucket output (stub)', async () => {
      const pr = {
        platform: 'bitbucket',
        id: '123'
      };

      const review = {
        summary: 'Test',
        comments: []
      };

      const config = {
        platforms: {
          bitbucket: { enabled: true }
        },
        output: { dryRun: false }
      };

      const result = await output.postReview(pr, review, config);

      expect(result.error).toContain('not implemented');
    });
  });

  describe('Summary formatting', () => {
    it('should include review statistics', () => {
      const review = {
        summary: 'Test review',
        decision: 'needs_work',
        issues: {
          critical: 1,
          major: 2,
          minor: 3
        }
      };

      const formatted = output.formatSummary(review);

      expect(formatted).toContain('Critical: 1');
      expect(formatted).toContain('Major: 2');
      expect(formatted).toContain('Minor: 3');
      expect(formatted).toContain('Total Issues: 6');
    });

    it('should use appropriate status emoji', () => {
      const approvedReview = { decision: 'approved', summary: 'Good' };
      const needsWorkReview = { decision: 'needs_work', summary: 'Issues' };
      const criticalReview = { decision: 'changes_requested', summary: 'Bad' };

      expect(output.formatSummary(approvedReview)).toContain('✅');
      expect(output.formatSummary(needsWorkReview)).toContain('⚠️');
      expect(output.formatSummary(criticalReview)).toContain('❌');
    });
  });
});