import ReviewState from '../../app/state/ReviewState.js';

describe('ReviewState', () => {
  let reviewState;

  beforeEach(() => {
    reviewState = new ReviewState('PR-123', 'gitlab', 'org/repo', 'feature-branch', 'main');
  });

  describe('initialization', () => {
    it('should initialize with correct properties', () => {
      expect(reviewState.prId).toBe('PR-123');
      expect(reviewState.platform).toBe('gitlab');
      expect(reviewState.repository).toBe('org/repo');
      expect(reviewState.branch).toBe('feature-branch');
      expect(reviewState.baseBranch).toBe('main');
      expect(reviewState.phase).toBe('initializing');
      expect(reviewState.timestamp).toBeInstanceOf(Date);
    });

    it('should initialize empty context structure', () => {
      expect(reviewState.context).toEqual({
        metadata: null,
        repository: null,
        diff: null,
        stats: null
      });
    });

    it('should initialize empty findings structure', () => {
      expect(reviewState.findings).toEqual({
        test: [],
        security: [],
        performance: [],
        architecture: []
      });
    });

    it('should initialize empty synthesis structure', () => {
      expect(reviewState.synthesis).toEqual({
        aggregated: [],
        conflicts: [],
        decision: null,
        rationale: null
      });
    });

    it('should initialize empty output structure', () => {
      expect(reviewState.output).toEqual({
        comments: [],
        summary: null,
        status: null
      });
    });

    it('should initialize empty checkpoints and errors', () => {
      expect(reviewState.checkpoints).toEqual([]);
      expect(reviewState.errors).toEqual([]);
    });
  });

  describe('transitionTo', () => {
    it('should transition to a new phase', () => {
      reviewState.transitionTo('review');
      expect(reviewState.phase).toBe('review');
    });

    it('should save checkpoint when transitioning', () => {
      const initialCheckpoints = reviewState.checkpoints.length;
      reviewState.transitionTo('review');
      expect(reviewState.checkpoints.length).toBe(initialCheckpoints + 1);
      const checkpoint = reviewState.checkpoints[0];
      expect(checkpoint.fromPhase).toBe('initializing');
      expect(checkpoint.toPhase).toBe('review');
      expect(checkpoint.timestamp).toBeInstanceOf(Date);
    });

    it('should throw error for invalid phase transition', () => {
      expect(() => reviewState.transitionTo('')).toThrow('Invalid phase');
      expect(() => reviewState.transitionTo(null)).toThrow('Invalid phase');
    });

    it('should maintain transition history', () => {
      reviewState.transitionTo('review');
      reviewState.transitionTo('synthesis');
      reviewState.transitionTo('output');
      expect(reviewState.checkpoints.length).toBe(3);
      expect(reviewState.phase).toBe('output');
    });
  });

  describe('addError', () => {
    it('should add error with phase context', () => {
      const error = new Error('Test error');
      reviewState.addError('review', error);
      expect(reviewState.errors.length).toBe(1);
      expect(reviewState.errors[0].phase).toBe('review');
      expect(reviewState.errors[0].error).toBe(error);
      expect(reviewState.errors[0].timestamp).toBeInstanceOf(Date);
    });

    it('should add multiple errors', () => {
      reviewState.addError('review', new Error('Error 1'));
      reviewState.addError('synthesis', new Error('Error 2'));
      expect(reviewState.errors.length).toBe(2);
      expect(reviewState.errors[0].phase).toBe('review');
      expect(reviewState.errors[1].phase).toBe('synthesis');
    });

    it('should handle error strings', () => {
      reviewState.addError('review', 'String error');
      expect(reviewState.errors.length).toBe(1);
      expect(reviewState.errors[0].error).toBe('String error');
    });
  });

  describe('serialization', () => {
    it('should convert to JSON and back', () => {
      reviewState.context.metadata = { title: 'Test PR' };
      reviewState.transitionTo('review');
      reviewState.addError('test', new Error('Test error'));

      const json = JSON.stringify(reviewState);
      const parsed = JSON.parse(json);

      expect(parsed.prId).toBe('PR-123');
      expect(parsed.phase).toBe('review');
      expect(parsed.context.metadata.title).toBe('Test PR');
      expect(parsed.checkpoints.length).toBe(1);
      expect(parsed.errors.length).toBe(1);
    });
  });
});