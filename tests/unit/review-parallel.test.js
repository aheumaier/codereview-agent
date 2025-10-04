import Anthropic from '@anthropic-ai/sdk';
import Review from '../../app/review.js';
import * as retryModule from '../../app/utils/retry.js';

jest.mock('@anthropic-ai/sdk');
jest.mock('../../app/utils/retry.js');

// Use fake timers for retry logic
jest.useFakeTimers();

describe('Review - Parallel Reviews', () => {
  let review;
  let mockMessages;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock Anthropic client
    mockMessages = {
      create: jest.fn()
    };

    Anthropic.mockImplementation(() => ({
      messages: mockMessages
    }));

    // Mock retry to execute immediately by default
    retryModule.retryWithBackoff.mockImplementation((fn) => fn());
    retryModule.isRetryableError.mockReturnValue(true);

    // Create fresh instance
    review = new Review();

    // Initialize the anthropic client mock
    review.anthropic = {
      messages: mockMessages
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  describe('runParallelReviews', () => {
    const mockContext = {
      pr: {
        title: 'Test PR',
        description: 'Test description',
        platform: 'gitlab',
        id: '123'
      },
      diff: [
        {
          old_path: 'src/app.js',
          new_path: 'src/app.js',
          diff: '@@ -1,3 +1,3 @@\n-console.log("test")\n+console.log("improved")\n'
        }
      ],
      stats: {
        filesChanged: 1,
        additions: 1,
        deletions: 1
      }
    };

    const mockConfig = {
      claude: {
        apiKey: 'test-key',
        model: 'claude-3-opus-20240229',
        maxTokens: 4096,
        temperature: 0.3
      },
      review: {
        parallelReviews: {
          enabled: true,
          temperatures: [0, 0.3]
        }
      }
    };

    it('should return error when all parallel reviews fail', async () => {
      // Mock both API calls to reject
      mockMessages.create
        .mockRejectedValueOnce(new Error('API Error 1'))
        .mockRejectedValueOnce(new Error('API Error 2'));

      // Execute parallel reviews
      const resultPromise = review.runParallelReviews(mockContext, mockConfig);

      // Fast-forward through retries for both reviews
      for (let i = 0; i < 4; i++) {
        await jest.advanceTimersByTimeAsync(10000);
        await Promise.resolve();
      }

      const result = await resultPromise;

      // Verify error response structure
      expect(result).toMatchObject({
        error: 'All parallel reviews failed',
        decision: 'error',
        comments: [],
        summary: 'Failed to complete any reviews'
      });

      // Verify both reviews were attempted
      expect(mockMessages.create).toHaveBeenCalled();
    });

    it('should return single review when one succeeds and other fails', async () => {
      const successfulReview = {
        summary: 'Good changes',
        decision: 'approved',
        comments: [
          {
            file: 'src/app.js',
            line: 1,
            severity: 'minor',
            message: 'Consider using const'
          }
        ]
      };

      // First review succeeds, second fails
      mockMessages.create
        .mockResolvedValueOnce({
          content: [{
            type: 'text',
            text: JSON.stringify(successfulReview)
          }]
        })
        .mockRejectedValueOnce(new Error('API Error'));

      const resultPromise = review.runParallelReviews(mockContext, mockConfig);

      // Fast-forward timers
      await jest.runAllTimersAsync();

      const result = await resultPromise;

      // Should return the successful review directly (no merge)
      expect(result).toMatchObject({
        summary: 'Good changes',
        decision: 'approved',
        comments: expect.arrayContaining([
          expect.objectContaining({
            file: 'src/app.js',
            severity: 'minor'
          })
        ])
      });

      // Verify synthesizeReviews was NOT called (no merge needed)
      const synthesizeSpy = jest.spyOn(review, 'synthesizeReviews');
      expect(synthesizeSpy).not.toHaveBeenCalled();
    });

    it('should call synthesizeReviews when multiple reviews succeed', async () => {
      const review1 = {
        summary: 'Review 1',
        decision: 'needs_work',
        comments: [
          {
            file: 'src/app.js',
            line: 1,
            severity: 'major',
            message: 'Issue 1'
          }
        ]
      };

      const review2 = {
        summary: 'Review 2',
        decision: 'needs_work',
        comments: [
          {
            file: 'src/app.js',
            line: 2,
            severity: 'minor',
            message: 'Issue 2'
          }
        ]
      };

      const mergedReview = {
        summary: 'Merged review',
        decision: 'needs_work',
        comments: [
          {
            file: 'src/app.js',
            line: 1,
            severity: 'major',
            message: 'Issue 1'
          },
          {
            file: 'src/app.js',
            line: 2,
            severity: 'minor',
            message: 'Issue 2'
          }
        ]
      };

      // Mock both reviews succeeding
      mockMessages.create
        .mockResolvedValueOnce({
          content: [{
            type: 'text',
            text: JSON.stringify(review1)
          }]
        })
        .mockResolvedValueOnce({
          content: [{
            type: 'text',
            text: JSON.stringify(review2)
          }]
        })
        // Mock the merge call
        .mockResolvedValueOnce({
          content: [{
            type: 'text',
            text: JSON.stringify(mergedReview)
          }]
        });

      const synthesizeSpy = jest.spyOn(review, 'synthesizeReviews');

      const resultPromise = review.runParallelReviews(mockContext, mockConfig);
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      // Verify synthesizeReviews was called with both reviews
      expect(synthesizeSpy).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ summary: 'Review 1' }),
          expect.objectContaining({ summary: 'Review 2' })
        ]),
        mockConfig
      );

      // Verify merged result
      expect(result).toMatchObject({
        summary: 'Merged review',
        decision: 'needs_work',
        comments: expect.arrayContaining([
          expect.objectContaining({ message: 'Issue 1' }),
          expect.objectContaining({ message: 'Issue 2' })
        ])
      });
    });

    it('should handle error boundaries preventing cascade failures', async () => {
      // Mock console.error to verify logging
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      // First review throws, second succeeds
      mockMessages.create
        .mockRejectedValueOnce(new Error('Catastrophic failure'))
        .mockResolvedValueOnce({
          content: [{
            type: 'text',
            text: JSON.stringify({
              summary: 'Successful review',
              decision: 'approved',
              comments: []
            })
          }]
        });

      const resultPromise = review.runParallelReviews(mockContext, mockConfig);
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      // Should return the successful review
      expect(result).toMatchObject({
        summary: 'Successful review',
        decision: 'approved'
      });

      // Verify error was logged (there are 2 error logs)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Review #1 error')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Review #1 failed')
      );

      consoleErrorSpy.mockRestore();
    });

    it('should fall back to single review when parallelReviews.enabled is false', async () => {
      const disabledConfig = {
        ...mockConfig,
        review: {
          parallelReviews: {
            enabled: false,
            temperatures: [0, 0.3]
          }
        }
      };

      mockMessages.create.mockResolvedValueOnce({
        content: [{
          type: 'text',
          text: JSON.stringify({
            summary: 'Single review',
            decision: 'approved',
            comments: []
          })
        }]
      });

      const resultPromise = review.runParallelReviews(mockContext, disabledConfig);
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      // Should execute single review
      expect(result).toMatchObject({
        summary: 'Single review',
        decision: 'approved'
      });

      // Only one API call should be made
      expect(mockMessages.create).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple temperatures beyond 2 reviews', async () => {
      const fourTempConfig = {
        ...mockConfig,
        review: {
          parallelReviews: {
            enabled: true,
            temperatures: [0, 0.1, 0.2, 0.3]
          }
        }
      };

      // Mock 4 successful reviews
      for (let i = 0; i < 4; i++) {
        mockMessages.create.mockResolvedValueOnce({
          content: [{
            type: 'text',
            text: JSON.stringify({
              summary: `Review ${i + 1}`,
              decision: 'approved',
              comments: []
            })
          }]
        });
      }

      // Mock the merge call
      mockMessages.create.mockResolvedValueOnce({
        content: [{
          type: 'text',
          text: JSON.stringify({
            summary: 'Merged 4 reviews',
            decision: 'approved',
            comments: []
          })
        }]
      });

      const resultPromise = review.runParallelReviews(mockContext, fourTempConfig);
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      // Verify all 4 reviews were attempted
      expect(mockMessages.create).toHaveBeenCalledTimes(5); // 4 reviews + 1 merge

      // Verify result
      expect(result).toMatchObject({
        summary: 'Merged 4 reviews',
        decision: 'approved'
      });
    });

    it('should handle partial failures in multiple reviews', async () => {
      const threeTempConfig = {
        ...mockConfig,
        review: {
          parallelReviews: {
            enabled: true,
            temperatures: [0, 0.1, 0.2]
          }
        }
      };

      // 2 succeed, 1 fails
      mockMessages.create
        .mockResolvedValueOnce({
          content: [{
            type: 'text',
            text: JSON.stringify({
              summary: 'Review 1',
              decision: 'approved',
              comments: []
            })
          }]
        })
        .mockRejectedValueOnce(new Error('Failed review'))
        .mockResolvedValueOnce({
          content: [{
            type: 'text',
            text: JSON.stringify({
              summary: 'Review 3',
              decision: 'approved',
              comments: []
            })
          }]
        })
        // Mock merge
        .mockResolvedValueOnce({
          content: [{
            type: 'text',
            text: JSON.stringify({
              summary: 'Merged 2 reviews',
              decision: 'approved',
              comments: []
            })
          }]
        });

      const resultPromise = review.runParallelReviews(mockContext, threeTempConfig);
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      // Should merge the 2 successful reviews
      expect(result).toMatchObject({
        summary: 'Merged 2 reviews',
        decision: 'approved'
      });
    });

    it('should pass correct temperature to each review', async () => {
      const tempConfig = {
        ...mockConfig,
        review: {
          parallelReviews: {
            enabled: true,
            temperatures: [0.1, 0.7]
          }
        }
      };

      mockMessages.create
        .mockResolvedValueOnce({
          content: [{
            type: 'text',
            text: JSON.stringify({ summary: 'R1', decision: 'approved', comments: [] })
          }]
        })
        .mockResolvedValueOnce({
          content: [{
            type: 'text',
            text: JSON.stringify({ summary: 'R2', decision: 'approved', comments: [] })
          }]
        })
        .mockResolvedValueOnce({
          content: [{
            type: 'text',
            text: JSON.stringify({ summary: 'Merged', decision: 'approved', comments: [] })
          }]
        });

      const resultPromise = review.runParallelReviews(mockContext, tempConfig);
      await jest.runAllTimersAsync();
      await resultPromise;

      // Check first review call has temperature 0.1
      expect(mockMessages.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
        temperature: 0.1
      }));

      // Check second review call has temperature 0.7
      expect(mockMessages.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
        temperature: 0.7
      }));
    });
  });

  describe('runSingleReviewWithTemp', () => {
    const mockPrompt = 'Review this code';
    const mockConfig = {
      claude: {
        model: 'claude-3',
        maxTokens: 4000
      }
    };

    it('should tag review with metadata', async () => {
      mockMessages.create.mockResolvedValueOnce({
        content: [{
          type: 'text',
          text: JSON.stringify({
            summary: 'Test review',
            decision: 'approved',
            comments: []
          })
        }]
      });

      const resultPromise = review.runSingleReviewWithTemp(mockPrompt, mockConfig, 0.5, 2);
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      // Should have metadata tags
      expect(result._reviewNumber).toBe(2);
      expect(result._temperature).toBe(0.5);

      // Should still have review content
      expect(result.summary).toBe('Test review');
    });

    it('should retry on failure with correct review number', async () => {
      // Use real timers for this test to avoid timing issues
      jest.useRealTimers();

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      let callCount = 0;
      // Mock retryWithBackoff to simulate retries
      retryModule.retryWithBackoff.mockImplementation(async (fn, options) => {
        callCount++;
        if (callCount < 3 && options.onRetry) {
          options.onRetry(new Error(`Attempt ${callCount}`), callCount, 2000);
        }
        // Return successful response
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              summary: 'Success after retry',
              decision: 'approved',
              comments: []
            })
          }]
        };
      });

      const result = await review.runSingleReviewWithTemp(mockPrompt, mockConfig, 0.3, 3);

      // Should succeed after retries
      expect(result.summary).toBe('Success after retry');
      expect(result._reviewNumber).toBe(3);

      // Verify retry logs include review number
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Review #3')
      );

      consoleLogSpy.mockRestore();

      // Restore fake timers for other tests
      jest.useFakeTimers();
    });
  });
});