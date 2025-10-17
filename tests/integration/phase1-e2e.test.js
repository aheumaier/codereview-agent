import StateManager from '../../app/state/StateManager.js';
import ReviewState from '../../app/state/ReviewState.js';
import FeatureFlags from '../../app/utils/featureFlags.js';
import fs from 'fs/promises';
import path from 'path';

describe('Phase 1 - End to End Integration', () => {
  let stateManager;
  let featureFlags;
  const testDbPath = ':memory:';

  beforeEach(async () => {
    stateManager = new StateManager(testDbPath);
    await stateManager.initialize();

    featureFlags = new FeatureFlags({
      useStateManagement: true,
      useSubAgents: false,
      useDecisionMatrix: false,
      legacyMode: false
    });
  });

  afterEach(async () => {
    if (stateManager) {
      await stateManager.close();
    }
  });

  describe('Complete review state lifecycle', () => {
    it('should handle full review workflow with state management', async () => {
      // 1. Create initial state
      const state = await stateManager.createState(
        'PR-E2E-001',
        'gitlab',
        'team/project',
        'feature/new-feature',
        'main'
      );

      expect(state.phase).toBe('initializing');

      // 2. Gather context
      state.context = {
        metadata: {
          title: 'Add new feature',
          author: 'developer@example.com',
          created: new Date().toISOString(),
          description: 'This PR adds a new feature'
        },
        repository: {
          language: 'javascript',
          files: 150,
          dependencies: ['vitest', 'sqlite3', 'express']
        },
        diff: {
          additions: 200,
          deletions: 50,
          modifiedFiles: 10,
          files: [
            { path: 'app/feature.js', additions: 100, deletions: 20 },
            { path: 'tests/feature.test.js', additions: 100, deletions: 30 }
          ]
        },
        stats: {
          coverage: 82,
          complexity: 8,
          duplicates: 0.02
        }
      };

      state.transitionTo('review');
      await stateManager.saveState(state);

      // 3. Perform reviews
      state.findings.test = [
        { severity: 'minor', message: 'Missing test for edge case', line: 45 }
      ];

      state.findings.security = [
        { severity: 'major', message: 'Input validation needed', line: 123 }
      ];

      state.findings.performance = [];

      state.findings.architecture = [
        { severity: 'minor', message: 'Consider using dependency injection', line: 67 }
      ];

      state.transitionTo('synthesis');
      await stateManager.saveState(state);

      // 4. Synthesize findings
      state.synthesis = {
        aggregated: [
          ...state.findings.test,
          ...state.findings.security,
          ...state.findings.architecture
        ],
        conflicts: [],
        decision: 'APPROVE_WITH_SUGGESTIONS',
        rationale: 'Code meets quality standards with minor improvements suggested'
      };

      state.transitionTo('output');
      await stateManager.saveState(state);

      // 5. Generate output
      state.output = {
        comments: [
          { file: 'app/feature.js', line: 123, text: 'Input validation needed' },
          { file: 'app/feature.js', line: 45, text: 'Missing test for edge case' }
        ],
        summary: `## Code Review Summary

**Decision**: APPROVE_WITH_SUGGESTIONS

### Findings:
- 1 major security issue
- 2 minor suggestions

### Coverage: 82% ✓
### Complexity: 8 (acceptable)

Please address the security concern before merging.`,
        status: 'success'
      };

      await stateManager.saveState(state);

      // 6. Verify full state persistence
      const loaded = await stateManager.loadState('PR-E2E-001', 'gitlab', 'team/project');

      expect(loaded.phase).toBe('output');
      expect(loaded.checkpoints.length).toBe(3);
      expect(loaded.context.metadata.title).toBe('Add new feature');
      expect(loaded.findings.security.length).toBe(1);
      expect(loaded.synthesis.decision).toBe('APPROVE_WITH_SUGGESTIONS');
      expect(loaded.output.comments.length).toBe(2);
    });

    it('should handle errors during review process', async () => {
      const state = await stateManager.createState('PR-ERROR-001', 'github', 'user/repo');

      // Simulate error during context gathering
      state.addError('context_gathering', new Error('Failed to clone repository'));
      state.addError('context_gathering', 'Retrying with different credentials');

      state.transitionTo('review');

      // Simulate error during review
      state.addError('review', new Error('Analysis timeout'));

      await stateManager.saveState(state);

      const loaded = await stateManager.loadState('PR-ERROR-001', 'github', 'user/repo');

      expect(loaded.errors.length).toBe(3);
      expect(loaded.errors[0].phase).toBe('context_gathering');
      expect(loaded.errors[2].phase).toBe('review');
      expect(loaded.phase).toBe('review');
    });
  });

  describe('Feature flag integration', () => {
    it('should respect feature flags for state management', async () => {
      const enabledFlags = new FeatureFlags({
        useStateManagement: true,
        legacyMode: false
      });

      const disabledFlags = new FeatureFlags({
        useStateManagement: false,
        legacyMode: true
      });

      expect(enabledFlags.isEnabled('useStateManagement')).toBe(true);
      expect(disabledFlags.isEnabled('useStateManagement')).toBe(false);

      // When state management is enabled
      if (enabledFlags.isEnabled('useStateManagement')) {
        const state = await stateManager.createState('PR-123', 'gitlab', 'org/repo');
        expect(state).toBeDefined();
      }

      // When legacy mode is enabled
      if (disabledFlags.isEnabled('legacyMode')) {
        // Would run legacy review flow
        expect(disabledFlags.isEnabled('useStateManagement')).toBe(false);
      }
    });

    it('should throw when required feature is not enabled', () => {
      const flags = new FeatureFlags({
        useStateManagement: false
      });

      expect(() => {
        flags.require('useStateManagement');
        // This code should not be reached
        stateManager.createState('PR-999', 'bitbucket', 'team/repo');
      }).toThrow('Feature "useStateManagement" is not enabled');
    });
  });

  describe('State persistence and recovery', () => {
    it('should recover review from any phase', async () => {
      const prId = 'PR-RECOVERY-001';
      const platform = 'gitlab';
      const repository = 'team/service';

      // Start review
      let state = await stateManager.createState(prId, platform, repository);
      state.context.metadata = { title: 'Initial PR' };
      await stateManager.saveState(state);

      // Simulate crash/restart - load state
      state = await stateManager.loadState(prId, platform, repository);
      expect(state.phase).toBe('initializing');

      // Continue from where we left off
      state.transitionTo('review');
      state.findings.test = [{ message: 'Test finding' }];
      await stateManager.saveState(state);

      // Another restart
      state = await stateManager.loadState(prId, platform, repository);
      expect(state.phase).toBe('review');
      expect(state.findings.test.length).toBe(1);

      // Complete the review
      state.transitionTo('synthesis');
      state.synthesis.decision = 'APPROVED';
      state.transitionTo('output');
      state.output.status = 'complete';
      await stateManager.saveState(state);

      // Final verification
      const final = await stateManager.loadState(prId, platform, repository);
      expect(final.phase).toBe('output');
      expect(final.output.status).toBe('complete');
      expect(final.checkpoints.length).toBe(3);
    });
  });

  describe('Cleanup operations', () => {
    it('should clean up old states', async () => {
      // Create multiple states
      const states = [];
      for (let i = 1; i <= 5; i++) {
        const state = await stateManager.createState(
          `PR-OLD-${i}`,
          'github',
          `org/repo-${i}`
        );
        states.push(state);
      }

      // Make some states old
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 10);

      for (let i = 1; i <= 3; i++) {
        await stateManager.db.run(
          'UPDATE review_states SET checkpoint_at = ? WHERE pr_id = ?',
          oldDate.toISOString(),
          `PR-OLD-${i}`
        );
      }

      // Clean up states older than 7 days
      const deleted = await stateManager.cleanupOldStates(7);
      expect(deleted).toBe(3);

      // Verify only recent states remain
      const remaining = await stateManager.db.all('SELECT pr_id FROM review_states ORDER BY pr_id');
      expect(remaining.length).toBe(2);
      expect(remaining[0].pr_id).toBe('PR-OLD-4');
      expect(remaining[1].pr_id).toBe('PR-OLD-5');
    });
  });

  describe('Concurrent operations', () => {
    it('should handle concurrent state updates', async () => {
      const prId = 'PR-CONCURRENT-001';
      const platform = 'bitbucket';
      const repository = 'workspace/repo';

      // Create initial state
      const state1 = await stateManager.createState(prId, platform, repository);
      const state2 = await stateManager.loadState(prId, platform, repository);

      // Simulate concurrent updates
      state1.context.metadata = { version: 1 };
      state2.context.metadata = { version: 2 };

      await stateManager.saveState(state1);
      await stateManager.saveState(state2);

      // Last write wins (UPSERT)
      const final = await stateManager.loadState(prId, platform, repository);
      expect(final.context.metadata.version).toBe(2);
    });
  });
});