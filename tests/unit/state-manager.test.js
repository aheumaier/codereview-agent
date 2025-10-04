import StateManager from '../../app/state/StateManager.js';
import ReviewState from '../../app/state/ReviewState.js';
import fs from 'fs/promises';
import path from 'path';

describe('StateManager', () => {
  let stateManager;
  const testDbPath = ':memory:'; // Use in-memory DB for tests

  beforeEach(async () => {
    stateManager = new StateManager(testDbPath);
    await stateManager.initialize();
  });

  afterEach(async () => {
    if (stateManager) {
      await stateManager.close();
    }
  });

  describe('initialization', () => {
    it('should create review_states table on initialize', async () => {
      const tables = await stateManager.db.all(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='review_states'"
      );
      expect(tables.length).toBe(1);
      expect(tables[0].name).toBe('review_states');
    });

    it('should handle multiple initializations gracefully', async () => {
      await stateManager.initialize(); // Second initialization
      const tables = await stateManager.db.all(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='review_states'"
      );
      expect(tables.length).toBe(1);
    });
  });

  describe('createState', () => {
    it('should create and save new ReviewState', async () => {
      const state = await stateManager.createState('PR-456', 'github', 'user/repo');

      expect(state).toBeInstanceOf(ReviewState);
      expect(state.prId).toBe('PR-456');
      expect(state.platform).toBe('github');
      expect(state.repository).toBe('user/repo');
      expect(state.phase).toBe('initializing');
    });

    it('should persist state to database', async () => {
      await stateManager.createState('PR-789', 'gitlab', 'group/project');

      const rows = await stateManager.db.all(
        'SELECT * FROM review_states WHERE pr_id = ?',
        'PR-789'
      );
      expect(rows.length).toBe(1);
      expect(rows[0].platform).toBe('gitlab');
      expect(rows[0].repository).toBe('group/project');
    });

    it('should set branch names when provided', async () => {
      const state = await stateManager.createState(
        'PR-999',
        'bitbucket',
        'team/repo',
        'feature-x',
        'develop'
      );

      expect(state.branch).toBe('feature-x');
      expect(state.baseBranch).toBe('develop');
    });
  });

  describe('loadState', () => {
    it('should load existing state from database', async () => {
      const originalState = await stateManager.createState('PR-111', 'github', 'org/app');
      originalState.context.metadata = { title: 'Test PR' };
      originalState.transitionTo('review');
      await stateManager.saveState(originalState);

      const loadedState = await stateManager.loadState('PR-111', 'github', 'org/app');

      expect(loadedState).toBeInstanceOf(ReviewState);
      expect(loadedState.prId).toBe('PR-111');
      expect(loadedState.phase).toBe('review');
      expect(loadedState.context.metadata.title).toBe('Test PR');
      expect(loadedState.checkpoints.length).toBe(1);
    });

    it('should return null for non-existent state', async () => {
      const state = await stateManager.loadState('NON-EXISTENT', 'github', 'org/repo');
      expect(state).toBeNull();
    });

    it('should handle complex state data', async () => {
      const state = await stateManager.createState('PR-222', 'gitlab', 'team/service');

      state.context = {
        metadata: { title: 'Complex PR', author: 'developer' },
        repository: { language: 'javascript', size: 1000 },
        diff: { additions: 100, deletions: 50 },
        stats: { coverage: 85, complexity: 10 }
      };

      state.findings = {
        test: [{ type: 'coverage', message: 'Low coverage' }],
        security: [{ type: 'vulnerability', message: 'SQL injection risk' }],
        performance: [],
        architecture: []
      };

      await stateManager.saveState(state);
      const loaded = await stateManager.loadState('PR-222', 'gitlab', 'team/service');

      expect(loaded.context.metadata.title).toBe('Complex PR');
      expect(loaded.context.stats.coverage).toBe(85);
      expect(loaded.findings.test.length).toBe(1);
      expect(loaded.findings.security[0].type).toBe('vulnerability');
    });
  });

  describe('saveState', () => {
    it('should update existing state', async () => {
      const state = await stateManager.createState('PR-333', 'bitbucket', 'workspace/repo');
      state.phase = 'review';
      await stateManager.saveState(state);

      state.phase = 'synthesis';
      await stateManager.saveState(state);

      const rows = await stateManager.db.all(
        'SELECT * FROM review_states WHERE pr_id = ?',
        'PR-333'
      );
      expect(rows.length).toBe(1);

      const saved = JSON.parse(rows[0].state_json);
      expect(saved.phase).toBe('synthesis');
    });

    it('should use UPSERT pattern (INSERT OR REPLACE)', async () => {
      const state1 = await stateManager.createState('PR-444', 'github', 'user/lib');
      state1.context.metadata = { version: 1 };
      await stateManager.saveState(state1);

      const state2 = new ReviewState('PR-444', 'github', 'user/lib');
      state2.context.metadata = { version: 2 };
      await stateManager.saveState(state2);

      const rows = await stateManager.db.all(
        'SELECT * FROM review_states WHERE pr_id = ?',
        'PR-444'
      );
      expect(rows.length).toBe(1);

      const saved = JSON.parse(rows[0].state_json);
      expect(saved.context.metadata.version).toBe(2);
    });

    it('should handle errors gracefully', async () => {
      const state = new ReviewState('PR-555', 'gitlab', 'org/repo');
      // Create circular reference - JSON.stringify will throw
      const obj = { a: 1 };
      obj.b = obj;
      state.context.metadata = obj;

      // This should throw due to circular reference
      await expect(stateManager.saveState(state)).rejects.toThrow('Converting circular structure to JSON');
    });
  });

  describe('cleanupOldStates', () => {
    it('should delete states older than specified days', async () => {
      // Create states with different timestamps
      const state1 = await stateManager.createState('PR-OLD', 'github', 'old/repo');
      const state2 = await stateManager.createState('PR-NEW', 'github', 'new/repo');

      // Manually update timestamp for old state (30 days ago)
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 30);
      await stateManager.db.run(
        'UPDATE review_states SET checkpoint_at = ? WHERE pr_id = ?',
        oldDate.toISOString(),
        'PR-OLD'
      );

      // Cleanup states older than 7 days
      const deleted = await stateManager.cleanupOldStates(7);
      expect(deleted).toBe(1);

      const remaining = await stateManager.db.all('SELECT * FROM review_states');
      expect(remaining.length).toBe(1);
      expect(remaining[0].pr_id).toBe('PR-NEW');
    });

    it('should return 0 when no old states exist', async () => {
      await stateManager.createState('PR-666', 'gitlab', 'team/app');
      const deleted = await stateManager.cleanupOldStates(30);
      expect(deleted).toBe(0);
    });

    it('should handle empty database', async () => {
      const deleted = await stateManager.cleanupOldStates(7);
      expect(deleted).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should handle database connection errors', async () => {
      const badManager = new StateManager('/invalid/path/to/database.db');
      await expect(badManager.initialize()).rejects.toThrow();
    });

    it('should validate input parameters', async () => {
      await expect(stateManager.createState(null, 'github', 'repo')).rejects.toThrow();
      await expect(stateManager.createState('PR-1', null, 'repo')).rejects.toThrow();
      await expect(stateManager.createState('PR-1', 'github', null)).rejects.toThrow();
    });
  });
});