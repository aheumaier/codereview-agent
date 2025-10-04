import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { CodeReviewError } from './utils/errorHelpers.js';

/**
 * Tracker module for managing PR review history
 */
class Tracker {
  constructor() {
    this.db = null;
  }

  /**
   * Initialize database and create tables
   * @param {string} dbPath - Path to SQLite database file
   */
  async initialize(dbPath) {
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (dir !== '.') {
      const fs = await import('fs');
      await fs.promises.mkdir(dir, { recursive: true });
    }

    // Open database connection
    this.db = await open({
      filename: dbPath,
      driver: sqlite3.Database
    });

    // Create reviews table
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL,
        repository TEXT NOT NULL,
        pr_id TEXT NOT NULL,
        sha TEXT,
        reviewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME,
        decision TEXT,
        summary TEXT,
        comments_count INTEGER DEFAULT 0,
        issues_found INTEGER DEFAULT 0,
        UNIQUE(platform, repository, pr_id)
      );

      CREATE INDEX IF NOT EXISTS idx_reviews_pr
        ON reviews(platform, repository, pr_id);

      CREATE INDEX IF NOT EXISTS idx_reviews_date
        ON reviews(reviewed_at);
    `);
  }

  /**
   * Check if a PR has been reviewed
   * @param {string} platform - Platform name (gitlab, github, bitbucket)
   * @param {string} repository - Repository identifier
   * @param {string} prId - Pull request ID
   * @param {string} prUpdatedAt - PR last updated timestamp
   * @returns {Promise<boolean>} True if already reviewed and up-to-date
   */
  async hasReviewed(platform, repository, prId, prUpdatedAt = null) {
    if (!this.db) {
      throw new CodeReviewError('Tracker not initialized - call initialize() first');
    }

    const query = `
      SELECT COUNT(*) as count, MAX(reviewed_at) as reviewed_at
      FROM reviews
      WHERE platform = ?
        AND repository = ?
        AND pr_id = ?
    `;

    const result = await this.db.get(query, [platform, repository, prId]);

    if (result.count === 0) {
      return false;
    }

    // If PR was updated after our last review, we need to review again
    if (prUpdatedAt && result.reviewed_at) {
      const lastReview = new Date(result.reviewed_at);
      const prUpdate = new Date(prUpdatedAt);
      return prUpdate <= lastReview;
    }

    return true;
  }

  /**
   * Mark a PR as reviewed
   * @param {Object} review - Review details
   */
  async markReviewed(review) {
    if (!this.db) {
      throw new CodeReviewError('Tracker not initialized - call initialize() first');
    }

    const query = `
      INSERT OR REPLACE INTO reviews (
        platform, repository, pr_id, sha,
        decision, summary, comments_count, issues_found,
        reviewed_at, updated_at
      ) VALUES (
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        CURRENT_TIMESTAMP, ?
      )
    `;

    await this.db.run(query, [
      review.platform,
      review.repository,
      review.prId,
      review.sha || null,
      review.decision || 'reviewed',
      review.summary || '',
      review.comments?.length || 0,
      review.comments?.filter(c => c.severity === 'critical' || c.severity === 'major').length || 0,
      review.prUpdatedAt || null
    ]);
  }

  /**
   * Get review history for a PR
   * @param {string} platform - Platform name
   * @param {string} repository - Repository identifier
   * @param {string} prId - Pull request ID
   * @returns {Promise<Array>} Review history
   */
  async getReviewHistory(platform, repository, prId) {
    if (!this.db) {
      throw new Error('Tracker not initialized');
    }

    const query = `
      SELECT * FROM reviews
      WHERE platform = ?
        AND repository = ?
        AND pr_id = ?
      ORDER BY reviewed_at DESC
    `;

    return await this.db.all(query, [platform, repository, prId]);
  }

  /**
   * Clean up old reviews
   * @param {number} ttlDays - Time to live in days
   * @returns {Promise<number>} Number of deleted records
   */
  async cleanup(ttlDays) {
    if (!this.db) {
      throw new Error('Tracker not initialized');
    }

    const query = `
      DELETE FROM reviews
      WHERE reviewed_at < datetime('now', '-' || ? || ' days')
    `;

    const result = await this.db.run(query, [ttlDays]);
    return result.changes;
  }

  /**
   * Close database connection
   */
  async close() {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }
}

export default Tracker;