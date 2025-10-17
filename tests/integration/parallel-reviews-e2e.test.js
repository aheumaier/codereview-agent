import { jest } from '@jest/globals';
import Anthropic from '@anthropic-ai/sdk';
import Review from '../../app/review.js';

// Mock Anthropic SDK
jest.mock('@anthropic-ai/sdk');

// Use fake timers for retry logic
jest.useFakeTimers();

describe('Review - Parallel Reviews E2E', () => {
  let review;
  let mockMessages;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock Anthropic client
    mockMessages = {
      create: jest.fn()
    };

    // Create fresh instance and inject mock
    review = new Review();
    review.anthropic = {
      messages: mockMessages
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  it('should execute full parallel review flow with deduplication', async () => {
    const context = {
      pr: {
        title: 'Add new feature',
        description: 'Implements user authentication',
        platform: 'gitlab',
        id: '456',
        author: 'john.doe'
      },
      diff: [
        {
          old_path: 'src/auth.js',
          new_path: 'src/auth.js',
          diff: '@@ -10,3 +10,5 @@\n function login(user, pass) {\n-  return true;\n+  if (!user || !pass) return false;\n+  console.log("logging in");\n+  return authenticate(user, pass);\n }'
        }
      ],
      files: [
        {
          path: 'src/auth.js',
          type: 'javascript',
          hasChanges: true
        }
      ],
      stats: {
        filesChanged: 1,
        additions: 3,
        deletions: 1,
        totalLines: 4
      }
    };

    const config = {
      claude: {
        model: 'claude-3-opus-20240229',
        maxTokens: 4096,
        apiKey: 'test-key',
        temperature: 0
      },
      review: {
        parallelReviews: {
          enabled: true,
          temperatures: [0, 0.3]
        },
        minCoveragePercent: 80,
        maxComplexity: 10
      }
    };

    // Mock review 1 (temp=0) - more strict
    mockMessages.create.mockResolvedValueOnce({
      content: [{
        text: JSON.stringify({
          decision: 'needs_work',
          summary: 'Code has security and quality issues',
          comments: [
            {
              file: 'src/auth.js',
              line: 12,
              message: 'Remove console.log from production code',
              severity: 'minor',
              why: 'Console logs can leak sensitive information',
              suggestion: 'Use proper logging library with levels'
            },
            {
              file: 'src/auth.js',
              line: 11,
              message: 'Add input validation',
              severity: 'major',
              why: 'Basic null check is not sufficient',
              suggestion: 'Validate input format and sanitize'
            },
            {
              file: 'src/auth.js',
              line: 13,
              message: 'authenticate function undefined',
              severity: 'critical',
              why: 'Code will fail at runtime',
              suggestion: 'Import or define authenticate function'
            }
          ],
          issues: {
            critical: 1,
            major: 1,
            minor: 1
          }
        })
      }]
    });

    // Mock review 2 (temp=0.3) - slightly different perspective
    mockMessages.create.mockResolvedValueOnce({
      content: [{
        text: JSON.stringify({
          decision: 'needs_work',
          summary: 'Authentication implementation needs improvements',
          comments: [
            {
              file: 'src/auth.js',
              line: 12,
              message: 'Console.log should not be in auth code',
              severity: 'minor',
              why: 'Security risk in production',
              suggestion: 'Remove or use debug logger'
            },
            {
              file: 'src/auth.js',
              line: 13,
              message: 'Missing authenticate function import',
              severity: 'critical',
              why: 'Runtime error will occur',
              suggestion: 'Add import statement'
            },
            {
              file: 'src/auth.js',
              line: 10,
              message: 'Function lacks JSDoc documentation',
              severity: 'minor',
              why: 'API documentation missing',
              suggestion: 'Add @param and @returns JSDoc'
            }
          ],
          issues: {
            critical: 1,
            major: 0,
            minor: 2
          }
        })
      }]
    });

    // Mock MECE merge - should deduplicate overlapping issues
    mockMessages.create.mockResolvedValueOnce({
      content: [{
        text: JSON.stringify({
          decision: 'needs_work',
          summary: 'Authentication implementation has critical issues and quality concerns',
          comments: [
            {
              file: 'src/auth.js',
              line: 13,
              message: 'authenticate function is undefined - will cause runtime error',
              severity: 'critical',
              why: 'Code will fail at runtime',
              suggestion: 'Import or define authenticate function',
              resources: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/Not_defined'
            },
            {
              file: 'src/auth.js',
              line: 11,
              message: 'Add comprehensive input validation',
              severity: 'major',
              why: 'Basic null check is insufficient for security',
              suggestion: 'Validate input format, length, and sanitize for injection attacks'
            },
            {
              file: 'src/auth.js',
              line: 12,
              message: 'Remove console.log from production code',
              severity: 'minor',
              why: 'Console logs can leak sensitive authentication information',
              suggestion: 'Use proper logging library with configurable levels'
            },
            {
              file: 'src/auth.js',
              line: 10,
              message: 'Function lacks JSDoc documentation',
              severity: 'minor',
              why: 'API documentation missing for public function',
              suggestion: 'Add @param {string} user - Username\\n@param {string} pass - Password\\n@returns {boolean} Authentication result'
            }
          ],
          issues: {
            critical: 1,
            major: 1,
            minor: 2
          }
        })
      }]
    });

    // Spy on internal methods to verify flow
    const runParallelSpy = jest.spyOn(review, 'runParallelReviews');
    const synthesizeSpy = jest.spyOn(review, 'synthesizeReviews');

    // Execute the review
    const resultPromise = review.reviewPR(context, config);

    // Fast-forward all timers
    await jest.runAllTimersAsync();

    const result = await resultPromise;

    // Verify parallel review was called
    expect(runParallelSpy).toHaveBeenCalledWith(context, config);

    // Verify synthesize was called (since multiple reviews succeeded)
    expect(synthesizeSpy).toHaveBeenCalled();

    // Verify final result structure
    expect(result.decision).toBe('needs_work');

    // Should have deduplicated comments (4 unique from original 6)
    expect(result.comments).toHaveLength(4);

    // Verify no metadata leakage
    expect(result._reviewNumber).toBeUndefined();
    expect(result._temperature).toBeUndefined();

    // Verify critical issue is present
    const criticalIssues = result.comments.filter(c => c.severity === 'critical');
    expect(criticalIssues).toHaveLength(1);
    expect(criticalIssues[0].message).toContain('authenticate');

    // Verify API was called 3 times (2 reviews + 1 merge)
    expect(mockMessages.create).toHaveBeenCalledTimes(3);

    // Verify first two calls used different temperatures
    expect(mockMessages.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      temperature: 0
    }));
    expect(mockMessages.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
      temperature: 0.3
    }));

    // Verify merge call used temperature 0
    expect(mockMessages.create).toHaveBeenNthCalledWith(3, expect.objectContaining({
      temperature: 0
    }));
  });

  it('should route to parallel reviews when enabled in config', async () => {
    const context = {
      pr: { title: 'Test PR', description: 'Test', platform: 'github' },
      diff: [{ new_path: 'test.js', diff: '+const x = 1;' }],
      stats: { filesChanged: 1, additions: 1, deletions: 0 }
    };

    const config = {
      claude: {
        model: 'claude-3',
        maxTokens: 4000,
        apiKey: 'test-key'
      },
      review: {
        parallelReviews: {
          enabled: true,
          temperatures: [0.1, 0.2]
        }
      }
    };

    // Mock successful reviews
    mockMessages.create
      .mockResolvedValueOnce({
        content: [{
          text: JSON.stringify({
            decision: 'approved',
            summary: 'R1',
            comments: []
          })
        }]
      })
      .mockResolvedValueOnce({
        content: [{
          text: JSON.stringify({
            decision: 'approved',
            summary: 'R2',
            comments: []
          })
        }]
      })
      .mockResolvedValueOnce({
        content: [{
          text: JSON.stringify({
            decision: 'approved',
            summary: 'Merged',
            comments: []
          })
        }]
      });

    // Spy on runParallelReviews
    const runParallelSpy = jest.spyOn(review, 'runParallelReviews');

    const resultPromise = review.reviewPR(context, config);
    await jest.runAllTimersAsync();
    await resultPromise;

    // Should have routed to parallel reviews
    expect(runParallelSpy).toHaveBeenCalledWith(context, config);
  });

  it('should route to single review when parallel disabled', async () => {
    const context = {
      pr: { title: 'Test PR', description: 'Test', platform: 'github' },
      diff: [{ new_path: 'test.js', diff: '+const x = 1;' }],
      stats: { filesChanged: 1, additions: 1, deletions: 0 }
    };

    const config = {
      claude: {
        model: 'claude-3',
        maxTokens: 4000,
        apiKey: 'test-key',
        temperature: 0.2
      },
      review: {
        parallelReviews: {
          enabled: false,
          temperatures: [0.1, 0.2]
        }
      }
    };

    // Mock single review
    mockMessages.create.mockResolvedValueOnce({
      content: [{
        text: JSON.stringify({
          decision: 'approved',
          summary: 'Single review',
          comments: []
        })
      }]
    });

    // Spy on runParallelReviews
    const runParallelSpy = jest.spyOn(review, 'runParallelReviews');

    const resultPromise = review.reviewPR(context, config);
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    // Should NOT have called parallel reviews
    expect(runParallelSpy).not.toHaveBeenCalled();

    // Should have single review result
    expect(result.summary).toBe('Single review');

    // Only one API call
    expect(mockMessages.create).toHaveBeenCalledTimes(1);
  });

  it('should handle graceful degradation when one review fails', async () => {
    const context = {
      pr: { title: 'Test PR', description: 'Test', platform: 'bitbucket' },
      diff: [{ new_path: 'app.py', diff: '+print("test")' }],
      stats: { filesChanged: 1, additions: 1, deletions: 0 }
    };

    const config = {
      claude: {
        model: 'claude-3',
        maxTokens: 4000,
        apiKey: 'test-key'
      },
      review: {
        parallelReviews: {
          enabled: true,
          temperatures: [0, 0.5]
        }
      }
    };

    // First review fails after retries, second succeeds
    mockMessages.create
      .mockRejectedValue(new Error('Network error'))  // All retries for first review fail
      .mockResolvedValueOnce({  // Second review succeeds
        content: [{
          text: JSON.stringify({
            decision: 'needs_work',
            summary: 'Single successful review',
            comments: [
              {
                file: 'app.py',
                line: 1,
                message: 'Use logging instead of print',
                severity: 'minor'
              }
            ]
          })
        }]
      });

    const resultPromise = review.reviewPR(context, config);

    // Fast-forward through retries
    for (let i = 0; i < 4; i++) {
      await jest.advanceTimersByTimeAsync(10000);
      await Promise.resolve();
    }

    const result = await resultPromise;

    // Should return the single successful review
    expect(result.summary).toBe('Single successful review');
    expect(result.comments).toHaveLength(1);

    // No merge should have been attempted
    const synthesizeSpy = jest.spyOn(review, 'synthesizeReviews');
    expect(synthesizeSpy).not.toHaveBeenCalled();
  });

  it('should handle complete failure of all parallel reviews', async () => {
    const context = {
      pr: { title: 'Test PR', description: 'Test', platform: 'gitlab' },
      diff: [{ new_path: 'test.rb', diff: '+puts "hello"' }],
      stats: { filesChanged: 1, additions: 1, deletions: 0 }
    };

    const config = {
      claude: {
        model: 'claude-3',
        maxTokens: 4000,
        apiKey: 'test-key'
      },
      review: {
        parallelReviews: {
          enabled: true,
          temperatures: [0.2, 0.4, 0.6]  // 3 parallel reviews
        }
      }
    };

    // All reviews fail
    mockMessages.create
      .mockRejectedValue(new Error('Service unavailable'));

    const resultPromise = review.reviewPR(context, config);

    // Fast-forward through all retries
    for (let i = 0; i < 4; i++) {
      await jest.advanceTimersByTimeAsync(10000);
      await Promise.resolve();
    }

    const result = await resultPromise;

    // Should return error structure
    expect(result).toMatchObject({
      error: 'All parallel reviews failed',
      decision: 'error',
      comments: [],
      summary: 'Failed to complete any reviews'
    });
  });

  it('should preserve review quality through parallel-merge pipeline', async () => {
    const context = {
      pr: {
        title: 'Security update',
        description: 'Fixes SQL injection vulnerability',
        platform: 'gitlab'
      },
      diff: [
        {
          old_path: 'db/query.js',
          new_path: 'db/query.js',
          diff: '@@ -5,2 +5,2 @@\n-const query = `SELECT * FROM users WHERE id = ${userId}`;\n+const query = `SELECT * FROM users WHERE id = ?`;\n+db.query(query, [userId]);'
        }
      ],
      stats: {
        filesChanged: 1,
        additions: 2,
        deletions: 1
      }
    };

    const config = {
      claude: {
        model: 'claude-3',
        maxTokens: 8192,
        apiKey: 'test-key'
      },
      review: {
        parallelReviews: {
          enabled: true,
          temperatures: [0, 0.4]
        }
      }
    };

    // Both reviews find the security improvement
    mockMessages.create
      .mockResolvedValueOnce({
        content: [{
          text: JSON.stringify({
            decision: 'approved',
            summary: 'Good security fix',
            comments: [
              {
                file: 'db/query.js',
                line: 6,
                message: 'Good fix for SQL injection using parameterized queries',
                severity: 'minor',
                why: 'This is the correct approach'
              }
            ]
          })
        }]
      })
      .mockResolvedValueOnce({
        content: [{
          text: JSON.stringify({
            decision: 'approved',
            summary: 'Security improvement confirmed',
            comments: [
              {
                file: 'db/query.js',
                line: 6,
                message: 'Parameterized query prevents SQL injection',
                severity: 'minor',
                why: 'Best practice for database queries'
              },
              {
                file: 'db/query.js',
                line: 7,
                message: 'Consider adding input validation as defense in depth',
                severity: 'minor',
                suggestion: 'Validate userId is numeric before query'
              }
            ]
          })
        }]
      })
      .mockResolvedValueOnce({
        content: [{
          text: JSON.stringify({
            decision: 'approved',
            summary: 'Security vulnerability fixed with parameterized queries',
            comments: [
              {
                file: 'db/query.js',
                line: 6,
                message: 'Excellent fix for SQL injection using parameterized queries',
                severity: 'minor',
                why: 'This is the industry best practice for preventing SQL injection',
                resources: 'https://owasp.org/www-community/attacks/SQL_Injection'
              },
              {
                file: 'db/query.js',
                line: 7,
                message: 'Consider adding input validation as defense in depth',
                severity: 'minor',
                suggestion: 'Validate userId is numeric before query execution',
                why: 'Multiple layers of security are recommended'
              }
            ],
            issues: {
              critical: 0,
              major: 0,
              minor: 2
            }
          })
        }]
      });

    const resultPromise = review.reviewPR(context, config);
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    // Should preserve security insights through pipeline
    expect(result.decision).toBe('approved');
    expect(result.summary.toLowerCase()).toMatch(/security|parameterized|sql/);

    // Should have merged comments intelligently
    expect(result.comments).toHaveLength(2);

    // Should include learning resources
    const resourceComment = result.comments.find(c => c.resources);
    expect(resourceComment).toBeDefined();
    expect(resourceComment.resources).toContain('owasp.org');
  });

  it('should maintain consistent decision logic across parallel reviews', async () => {
    const context = {
      pr: { title: 'Mixed changes', description: 'Various updates', platform: 'github' },
      diff: [{ new_path: 'app.js', diff: '+// changes' }],
      stats: { filesChanged: 1, additions: 1, deletions: 0 }
    };

    const config = {
      claude: {
        model: 'claude-3',
        maxTokens: 4000,
        apiKey: 'test-key'
      },
      review: {
        parallelReviews: {
          enabled: true,
          temperatures: [0, 0.2, 0.4]
        }
      }
    };

    // Different decisions from reviews
    mockMessages.create
      .mockResolvedValueOnce({
        content: [{
          text: JSON.stringify({
            decision: 'approved',
            summary: 'Looks good',
            comments: []
          })
        }]
      })
      .mockResolvedValueOnce({
        content: [{
          text: JSON.stringify({
            decision: 'needs_work',
            summary: 'Has issues',
            comments: [{ file: 'app.js', line: 1, message: 'Issue', severity: 'major' }]
          })
        }]
      })
      .mockResolvedValueOnce({
        content: [{
          text: JSON.stringify({
            decision: 'approved',
            summary: 'Minor issues only',
            comments: []
          })
        }]
      })
      // Merge should choose most conservative
      .mockResolvedValueOnce({
        content: [{
          text: JSON.stringify({
            decision: 'needs_work',  // Most conservative decision
            summary: 'Mixed feedback, needs attention to issues',
            comments: [{ file: 'app.js', line: 1, message: 'Issue needs fixing', severity: 'major' }]
          })
        }]
      });

    const resultPromise = review.reviewPR(context, config);
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    // Should use most conservative decision
    expect(result.decision).toBe('needs_work');

    // Should preserve the major issue
    expect(result.comments).toContainEqual(
      expect.objectContaining({ severity: 'major' })
    );
  });
});