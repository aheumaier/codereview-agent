import { jest } from '@jest/globals';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

// Mock the database
jest.mock('sqlite', () => ({
  open: jest.fn()
}));

describe('Tracker Module', () => {
  let tracker;
  let mockDb;

  beforeEach(async () => {
    jest.resetModules();

    // Create mock database
    mockDb = {
      exec: jest.fn(),
      get: jest.fn(),
      run: jest.fn(),
      all: jest.fn(),
      close: jest.fn()
    };

    open.mockResolvedValue(mockDb);

    const trackerModule = await import('../../app/tracker.js');
    tracker = trackerModule.default;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialize', () => {
    it('should create database and tables', async () => {
      await tracker.initialize('./test.db');

      expect(open).toHaveBeenCalledWith({
        filename: './test.db',
        driver: sqlite3.Database
      });

      expect(mockDb.exec).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS reviews')
      );
    });

    it('should handle database initialization errors', async () => {
      mockDb.exec.mockRejectedValue(new Error('Database error'));

      await expect(tracker.initialize('./test.db')).rejects.toThrow('Database error');
    });
  });

  describe('hasReviewed', () => {
    it('should return true if PR has been reviewed', async () => {
      mockDb.get.mockResolvedValue({ count: 1 });

      await tracker.initialize('./test.db');
      const result = await tracker.hasReviewed('gitlab', 'project/repo', '123');

      expect(result).toBe(true);
      expect(mockDb.get).toHaveBeenCalledWith(
        expect.stringContaining('SELECT COUNT(*) as count FROM reviews'),
        { platform: 'gitlab', repository: 'project/repo', pr_id: '123' }
      );
    });

    it('should return false if PR has not been reviewed', async () => {
      mockDb.get.mockResolvedValue({ count: 0 });

      await tracker.initialize('./test.db');
      const result = await tracker.hasReviewed('gitlab', 'project/repo', '123');

      expect(result).toBe(false);
    });

    it('should handle updated PRs', async () => {
      mockDb.get.mockResolvedValue({ count: 1, updated_at: '2024-01-01T00:00:00Z' });

      await tracker.initialize('./test.db');
      const prUpdatedAt = '2024-01-02T00:00:00Z';
      const result = await tracker.hasReviewed('gitlab', 'project/repo', '123', prUpdatedAt);

      expect(result).toBe(false); // PR was updated after last review
    });
  });

  describe('markReviewed', () => {
    it('should mark PR as reviewed', async () => {
      mockDb.run.mockResolvedValue({ changes: 1 });

      await tracker.initialize('./test.db');
      const review = {
        platform: 'gitlab',
        repository: 'project/repo',
        prId: '123',
        sha: 'abc123',
        summary: 'Test review',
        decision: 'approved',
        comments: []
      };

      await tracker.markReviewed(review);

      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR REPLACE INTO reviews'),
        expect.objectContaining({
          platform: 'gitlab',
          repository: 'project/repo',
          pr_id: '123'
        })
      );
    });

    it('should handle database errors when marking reviewed', async () => {
      mockDb.run.mockRejectedValue(new Error('Insert failed'));

      await tracker.initialize('./test.db');
      const review = {
        platform: 'gitlab',
        repository: 'project/repo',
        prId: '123'
      };

      await expect(tracker.markReviewed(review)).rejects.toThrow('Insert failed');
    });
  });

  describe('getReviewHistory', () => {
    it('should return review history for a PR', async () => {
      const mockHistory = [
        { reviewed_at: '2024-01-01T00:00:00Z', decision: 'approved' }
      ];
      mockDb.all.mockResolvedValue(mockHistory);

      await tracker.initialize('./test.db');
      const history = await tracker.getReviewHistory('gitlab', 'project/repo', '123');

      expect(history).toEqual(mockHistory);
      expect(mockDb.all).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM reviews'),
        { platform: 'gitlab', repository: 'project/repo', pr_id: '123' }
      );
    });

    it('should return empty array if no history exists', async () => {
      mockDb.all.mockResolvedValue([]);

      await tracker.initialize('./test.db');
      const history = await tracker.getReviewHistory('gitlab', 'project/repo', '123');

      expect(history).toEqual([]);
    });
  });

  describe('cleanup', () => {
    it('should remove old reviews', async () => {
      mockDb.run.mockResolvedValue({ changes: 5 });

      await tracker.initialize('./test.db');
      const deleted = await tracker.cleanup(30);

      expect(deleted).toBe(5);
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM reviews WHERE'),
        expect.any(Object)
      );
    });
  });

  describe('close', () => {
    it('should close database connection', async () => {
      await tracker.initialize('./test.db');
      await tracker.close();

      expect(mockDb.close).toHaveBeenCalled();
    });

    it('should handle close without initialization', async () => {
      await expect(tracker.close()).resolves.not.toThrow();
    });
  });
});