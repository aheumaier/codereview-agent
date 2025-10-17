import { jest } from '@jest/globals';
import Anthropic from '@anthropic-ai/sdk';
import Review from '../../app/review.js';

// Mock Anthropic SDK
jest.mock('@anthropic-ai/sdk');

// Use fake timers for retry logic
jest.useFakeTimers();

describe('Review - MECE Merge', () => {
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

  describe('mergeReviewsWithClaude', () => {
    const mockConfig = {
      claude: {
        apiKey: 'test-key',
        model: 'claude-3-opus-20240229',
        maxTokens: 4096
      }
    };

    it('should deduplicate same issue at same line', async () => {
      const inputReviews = [
        {
          decision: 'needs_work',
          summary: 'Review 1 summary',
          comments: [
            { file: 'test.js', line: 10, message: 'Missing error handling', severity: 'major' },
            { file: 'test.js', line: 20, message: 'Unused variable', severity: 'minor' }
          ],
          _reviewNumber: 1,
          _temperature: 0
        },
        {
          decision: 'needs_work',
          summary: 'Review 2 summary',
          comments: [
            { file: 'test.js', line: 10, message: 'No error handling present', severity: 'major' },
            { file: 'other.js', line: 5, message: 'Different issue', severity: 'minor' }
          ],
          _reviewNumber: 2,
          _temperature: 0.3
        }
      ];

      // Mock Claude to return deduplicated result
      mockMessages.create.mockResolvedValue({
        content: [{
          text: JSON.stringify({
            decision: 'needs_work',
            summary: 'Merged review with deduplicated issues',
            comments: [
              { file: 'test.js', line: 10, message: 'Missing error handling', severity: 'major' },
              { file: 'test.js', line: 20, message: 'Unused variable', severity: 'minor' },
              { file: 'other.js', line: 5, message: 'Different issue', severity: 'minor' }
            ],
            issues: {
              critical: 0,
              major: 1,
              minor: 2
            }
          })
        }]
      });

      const result = await review.mergeReviewsWithClaude(inputReviews, mockConfig);

      // Should have 3 unique comments (deduped from 4)
      expect(result.comments).toHaveLength(3);

      // Should not have duplicate at line 10
      const line10Comments = result.comments.filter(c => c.file === 'test.js' && c.line === 10);
      expect(line10Comments).toHaveLength(1);

      // Metadata should be removed
      expect(result._reviewNumber).toBeUndefined();
      expect(result._temperature).toBeUndefined();
    });

    it('should remove metadata from merged review', async () => {
      const inputReviews = [
        {
          summary: 'Review 1',
          decision: 'approved',
          comments: [],
          _reviewNumber: 1,
          _temperature: 0.2
        },
        {
          summary: 'Review 2',
          decision: 'approved',
          comments: [],
          _reviewNumber: 2,
          _temperature: 0.4
        }
      ];

      mockMessages.create.mockResolvedValue({
        content: [{
          text: JSON.stringify({
            summary: 'Merged successfully',
            decision: 'approved',
            comments: [],
            issues: { critical: 0, major: 0, minor: 0 }
          })
        }]
      });

      const result = await review.mergeReviewsWithClaude(inputReviews, mockConfig);

      // Metadata should be removed
      expect(result._reviewNumber).toBeUndefined();
      expect(result._temperature).toBeUndefined();

      // Regular properties should exist
      expect(result.summary).toBe('Merged successfully');
      expect(result.decision).toBe('approved');
    });

    it('should remove metadata from fallback review on error', async () => {
      const inputReviews = [
        {
          summary: 'Fallback review',
          decision: 'needs_work',
          comments: [
            { file: 'test.js', line: 1, message: 'Issue', severity: 'major' }
          ],
          _reviewNumber: 1,
          _temperature: 0.1
        },
        {
          summary: 'Review 2',
          decision: 'approved',
          comments: [],
          _reviewNumber: 2,
          _temperature: 0.5
        }
      ];

      // Mock Claude API to reject
      mockMessages.create.mockRejectedValue(new Error('API failure'));

      const resultPromise = review.mergeReviewsWithClaude(inputReviews, mockConfig);

      // Fast-forward through retries
      for (let i = 0; i < 4; i++) {
        await jest.advanceTimersByTimeAsync(10000);
        await Promise.resolve();
      }

      const result = await resultPromise;

      // Should fallback to first review
      expect(result.summary).toBe('Fallback review');
      expect(result.decision).toBe('needs_work');

      // Metadata should be removed even in fallback
      expect(result._reviewNumber).toBeUndefined();
      expect(result._temperature).toBeUndefined();

      // Should preserve comments
      expect(result.comments).toHaveLength(1);
      expect(result.comments[0].message).toBe('Issue');
    });

    it('should throw error for empty reviews array', async () => {
      await expect(
        review.mergeReviewsWithClaude([], mockConfig)
      ).rejects.toThrow('No reviews to merge');
    });

    it('should return single review without API call', async () => {
      const singleReview = {
        summary: 'Only review',
        decision: 'approved',
        comments: [],
        _reviewNumber: 1,
        _temperature: 0.3
      };

      const result = await review.mergeReviewsWithClaude([singleReview], mockConfig);

      // Should return the same review immediately
      expect(result).toEqual(singleReview);

      // No API call should be made
      expect(mockMessages.create).not.toHaveBeenCalled();
    });

    it('should log merge statistics', async () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      const inputReviews = [
        {
          decision: 'needs_work',
          comments: [
            { file: 'a.js', line: 1, message: 'Issue 1', severity: 'major' },
            { file: 'a.js', line: 2, message: 'Issue 2', severity: 'minor' },
            { file: 'b.js', line: 1, message: 'Issue 3', severity: 'minor' }
          ]
        },
        {
          decision: 'needs_work',
          comments: [
            { file: 'a.js', line: 1, message: 'Issue 1 duplicate', severity: 'major' },
            { file: 'c.js', line: 1, message: 'Issue 4', severity: 'critical' }
          ]
        }
      ];

      mockMessages.create.mockResolvedValue({
        content: [{
          text: JSON.stringify({
            decision: 'needs_work',
            summary: 'Merged',
            comments: [
              { file: 'a.js', line: 1, message: 'Issue 1', severity: 'major' },
              { file: 'a.js', line: 2, message: 'Issue 2', severity: 'minor' },
              { file: 'b.js', line: 1, message: 'Issue 3', severity: 'minor' },
              { file: 'c.js', line: 1, message: 'Issue 4', severity: 'critical' }
            ]
          })
        }]
      });

      await review.mergeReviewsWithClaude(inputReviews, mockConfig);

      // Should log the merge statistics
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('5 input comments → 4 unique')
      );

      consoleLogSpy.mockRestore();
    });

    it('should use temperature 0 for deterministic merging', async () => {
      const inputReviews = [
        { summary: 'R1', decision: 'approved', comments: [] },
        { summary: 'R2', decision: 'approved', comments: [] }
      ];

      mockMessages.create.mockResolvedValue({
        content: [{
          text: JSON.stringify({
            summary: 'Merged',
            decision: 'approved',
            comments: []
          })
        }]
      });

      await review.mergeReviewsWithClaude(inputReviews, mockConfig);

      // Should use temperature 0 for deterministic merge
      expect(mockMessages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0
        })
      );
    });

    it('should handle complex duplicate detection across files', async () => {
      const inputReviews = [
        {
          decision: 'needs_work',
          comments: [
            { file: 'src/app.js', line: 10, message: 'Missing validation', severity: 'major' },
            { file: 'src/app.js', line: 11, message: 'Similar issue', severity: 'major' },
            { file: 'test/app.test.js', line: 5, message: 'Test coverage low', severity: 'minor' }
          ],
          _reviewNumber: 1,
          _temperature: 0
        },
        {
          decision: 'needs_work',
          comments: [
            { file: 'src/app.js', line: 10, message: 'No input validation', severity: 'major' },
            { file: 'src/app.js', line: 12, message: 'Similar issue nearby', severity: 'major' },
            { file: 'test/app.test.js', line: 5, message: 'Insufficient test coverage', severity: 'minor' }
          ],
          _reviewNumber: 2,
          _temperature: 0.3
        }
      ];

      // Mock intelligent deduplication
      mockMessages.create.mockResolvedValue({
        content: [{
          text: JSON.stringify({
            decision: 'needs_work',
            summary: 'Merged with intelligent deduplication',
            comments: [
              { file: 'src/app.js', line: 10, message: 'Missing input validation', severity: 'major' },
              { file: 'test/app.test.js', line: 5, message: 'Test coverage insufficient', severity: 'minor' }
            ],
            issues: {
              critical: 0,
              major: 1,
              minor: 1
            }
          })
        }]
      });

      const result = await review.mergeReviewsWithClaude(inputReviews, mockConfig);

      // Should intelligently deduplicate from 6 to 2 comments
      expect(result.comments).toHaveLength(2);

      // Should not have metadata
      expect(result._reviewNumber).toBeUndefined();
      expect(result._temperature).toBeUndefined();
    });

    it('should preserve highest severity when merging duplicates', async () => {
      const inputReviews = [
        {
          decision: 'needs_work',
          comments: [
            { file: 'app.js', line: 10, message: 'Security issue', severity: 'minor' }
          ]
        },
        {
          decision: 'needs_work',
          comments: [
            { file: 'app.js', line: 10, message: 'Security vulnerability', severity: 'critical' }
          ]
        }
      ];

      mockMessages.create.mockResolvedValue({
        content: [{
          text: JSON.stringify({
            decision: 'needs_work',
            summary: 'Merged with highest severity',
            comments: [
              { file: 'app.js', line: 10, message: 'Security vulnerability', severity: 'critical' }
            ],
            issues: {
              critical: 1,
              major: 0,
              minor: 0
            }
          })
        }]
      });

      const result = await review.mergeReviewsWithClaude(inputReviews, mockConfig);

      // Should keep critical severity (highest)
      expect(result.comments[0].severity).toBe('critical');
    });

    it('should handle retry logic for merge API calls', async () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      const inputReviews = [
        { summary: 'R1', decision: 'approved', comments: [] },
        { summary: 'R2', decision: 'approved', comments: [] }
      ];

      // Fail once, then succeed
      mockMessages.create
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValueOnce({
          content: [{
            text: JSON.stringify({
              summary: 'Merged after retry',
              decision: 'approved',
              comments: []
            })
          }]
        });

      const resultPromise = review.mergeReviewsWithClaude(inputReviews, mockConfig);

      // Advance through retry delay
      await jest.advanceTimersByTimeAsync(2000); // Initial delay
      await Promise.resolve();
      await jest.runOnlyPendingTimersAsync();

      const result = await resultPromise;

      // Should succeed after retry
      expect(result.summary).toBe('R1');

      // Should log fallback (no retry for 2 reviews)
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Falling back to first review')
      );

      consoleLogSpy.mockRestore();
    });
  });

  describe('synthesizeReviews', () => {
    const mockConfig = {
      claude: {
        apiKey: 'test-key',
        model: 'claude-3',
        maxTokens: 4000
      }
    };

    it('should delegate to mergeReviewsWithClaude', async () => {
      const mockReviews = [
        { summary: 'Review 1', decision: 'approved', comments: [] },
        { summary: 'Review 2', decision: 'approved', comments: [] }
      ];

      // Mock the merge response
      mockMessages.create.mockResolvedValue({
        content: [{
          text: JSON.stringify({
            summary: 'Delegated merge',
            decision: 'approved',
            comments: []
          })
        }]
      });

      // Spy on mergeReviewsWithClaude
      const mergeSpy = jest.spyOn(review, 'mergeReviewsWithClaude');

      const result = await review.synthesizeReviews(mockReviews, mockConfig);

      // Should call mergeReviewsWithClaude
      expect(mergeSpy).toHaveBeenCalledWith(mockReviews, mockConfig);

      // Should return merged result
      expect(result.summary).toBe('Delegated merge');
    });

    it('should log that Claude SDK MECE merge is being used', async () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      const mockReviews = [
        { summary: 'R1', decision: 'approved', comments: [] },
        { summary: 'R2', decision: 'approved', comments: [] }
      ];

      mockMessages.create.mockResolvedValue({
        content: [{
          text: JSON.stringify({
            summary: 'Merged',
            decision: 'approved',
            comments: []
          })
        }]
      });

      await review.synthesizeReviews(mockReviews, mockConfig);

      // Should log the merge method
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Using Claude SDK MECE merge')
      );

      consoleLogSpy.mockRestore();
    });

    it('should pass config through to merge function', async () => {
      const mockReviews = [
        { summary: 'R1', decision: 'approved', comments: [] }
      ];

      const customConfig = {
        claude: {
          apiKey: 'custom-key',
          model: 'claude-3-custom',
          maxTokens: 8192
        }
      };

      // Spy on mergeReviewsWithClaude
      const mergeSpy = jest.spyOn(review, 'mergeReviewsWithClaude');

      await review.synthesizeReviews(mockReviews, customConfig);

      // Should pass custom config through
      expect(mergeSpy).toHaveBeenCalledWith(mockReviews, customConfig);
    });
  });

  describe('MECE merge prompt construction', () => {
    const mockConfig = {
      claude: {
        apiKey: 'test-key',
        model: 'claude-3',
        maxTokens: 4000
      }
    };

    it('should include MECE principles in merge prompt', async () => {
      const inputReviews = [
        { summary: 'R1', decision: 'approved', comments: [], _temperature: 0.1 },
        { summary: 'R2', decision: 'approved', comments: [], _temperature: 0.3 }
      ];

      mockMessages.create.mockResolvedValue({
        content: [{
          text: JSON.stringify({
            summary: 'Merged',
            decision: 'approved',
            comments: []
          })
        }]
      });

      await review.mergeReviewsWithClaude(inputReviews, mockConfig);

      // Check the prompt includes MECE principles
      const call = mockMessages.create.mock.calls[0][0];
      const prompt = call.messages[0].content;

      expect(prompt).toContain('MECE');
      expect(prompt).toContain('Mutually Exclusive');
      expect(prompt).toContain('Collectively Exhaustive');
      expect(prompt).toContain('Same file + same line = definitely duplicate');
    });

    it('should include review metadata in prompt', async () => {
      const inputReviews = [
        { summary: 'R1', decision: 'needs_work', comments: [], _temperature: 0.2 },
        { summary: 'R2', decision: 'approved', comments: [], _temperature: 0.5 }
      ];

      mockMessages.create.mockResolvedValue({
        content: [{
          text: JSON.stringify({
            summary: 'Merged',
            decision: 'needs_work',
            comments: []
          })
        }]
      });

      await review.mergeReviewsWithClaude(inputReviews, mockConfig);

      const call = mockMessages.create.mock.calls[0][0];
      const prompt = call.messages[0].content;

      // Should include temperature values
      expect(prompt).toContain('temperature=0.2');
      expect(prompt).toContain('temperature=0.5');

      // Should include decisions
      expect(prompt).toContain('Decision: needs_work');
      expect(prompt).toContain('Decision: approved');
    });
  });
});