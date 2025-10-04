import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import ReviewState from './ReviewState.js';
import path from 'path';

/**
 * StateManager - Manages persistence of ReviewState to SQLite
 *
 * This class handles all database operations for review states,
 * providing persistence, recovery, and cleanup capabilities.
 */
class StateManager {
  constructor(databasePath = null) {
    // Default to data/reviews.db if no path specified
    // Using relative path from project root
    this.databasePath = databasePath || './data/reviews.db';
    this.db = null;
  }

  /**
   * Initialize the database and create tables if needed
   */
  async initialize() {
    try {
      // Open database connection
      this.db = await open({
        filename: this.databasePath,
        driver: sqlite3.Database
      });

      // Create review_states table if not exists
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS review_states (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          pr_id TEXT NOT NULL,
          platform TEXT NOT NULL,
          repository TEXT NOT NULL,
          phase TEXT NOT NULL,
          state_json TEXT NOT NULL,
          checkpoint_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(pr_id, platform, repository)
        )
      `);

      // Create indexes for performance
      await this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_review_states_pr
        ON review_states(pr_id, platform, repository)
      `);

      await this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_review_states_checkpoint
        ON review_states(checkpoint_at)
      `);

    } catch (error) {
      throw new Error(`Failed to initialize database: ${error.message}`);
    }
  }

  /**
   * Create a new ReviewState and save to database
   * @param {string} prId - Pull request ID
   * @param {string} platform - Platform (github, gitlab, bitbucket)
   * @param {string} repository - Repository path
   * @param {string} branch - Source branch name (optional)
   * @param {string} baseBranch - Target branch name (optional)
   * @param {string} iid - Internal ID for GitLab (optional)
   * @returns {ReviewState} New review state instance
   */
  async createState(prId, platform, repository, branch = null, baseBranch = null, iid = null) {
    // Validate required parameters
    if (!prId) throw new Error('prId is required');
    if (!platform) throw new Error('platform is required');
    if (!repository) throw new Error('repository is required');

    // Create new ReviewState
    const state = new ReviewState(prId, platform, repository, branch, baseBranch, iid);

    // Save to database
    await this.saveState(state);

    return state;
  }

  /**
   * Load existing ReviewState from database
   * @param {string} prId - Pull request ID
   * @param {string} platform - Platform
   * @param {string} repository - Repository path
   * @returns {ReviewState|null} Loaded state or null if not found
   */
  async loadState(prId, platform, repository) {
    try {
      const row = await this.db.get(
        `SELECT state_json FROM review_states
         WHERE pr_id = ? AND platform = ? AND repository = ?`,
        [prId, platform, repository]
      );

      if (!row) {
        return null;
      }

      // Parse JSON and create ReviewState
      const json = JSON.parse(row.state_json);
      return ReviewState.fromJSON(json);

    } catch (error) {
      console.error(`Error loading state for PR ${prId}:`, error);
      return null;
    }
  }

  /**
   * Save ReviewState to database (UPSERT)
   * @param {ReviewState} state - State to save
   */
  async saveState(state) {
    if (!(state instanceof ReviewState)) {
      throw new Error('state must be an instance of ReviewState');
    }

    try {
      // Serialize state to JSON
      const stateJson = JSON.stringify(state);

      // UPSERT: Insert or replace existing
      await this.db.run(
        `INSERT OR REPLACE INTO review_states
         (pr_id, platform, repository, phase, state_json, checkpoint_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`,
        [
          state.prId,
          state.platform,
          state.repository,
          state.phase,
          stateJson
        ]
      );

    } catch (error) {
      throw new Error(`Failed to save state: ${error.message}`);
    }
  }

  /**
   * Delete states older than specified days
   * @param {number} daysOld - Number of days to keep
   * @returns {number} Number of deleted states
   */
  async cleanupOldStates(daysOld) {
    if (typeof daysOld !== 'number' || daysOld < 0) {
      throw new Error('daysOld must be a positive number');
    }

    try {
      const result = await this.db.run(
        `DELETE FROM review_states
         WHERE checkpoint_at < datetime('now', '-' || ? || ' days')`,
        [daysOld]
      );

      return result.changes || 0;

    } catch (error) {
      console.error('Error cleaning up old states:', error);
      return 0;
    }
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

export default StateManager;