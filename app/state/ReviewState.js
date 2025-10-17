/**
 * ReviewState - Represents the complete state of a code review
 *
 * This class encapsulates all data and state transitions for a single PR review,
 * providing a centralized state management solution for the review process.
 */
class ReviewState {
  constructor(prId, platform, repository, branch = null, baseBranch = null, iid = null) {
    // Validate required parameters
    if (!prId) throw new Error('Invalid prId: prId is required');
    if (!platform) throw new Error('Invalid platform: platform is required');
    if (!repository) throw new Error('Invalid repository: repository is required');

    // Core identifiers
    this.prId = prId;
    this.iid = iid;  // GitLab internal ID (iid), optional for other platforms
    this.platform = platform;
    this.repository = repository;
    this.branch = branch;
    this.baseBranch = baseBranch;

    // Context information gathered during review
    this.context = {
      metadata: null,     // PR metadata (title, author, description, etc.)
      repository: null,   // Repository info (language, dependencies, etc.)
      diff: null,         // Diff statistics and file changes
      stats: null         // Code quality metrics (coverage, complexity, etc.)
    };

    // Review findings by category
    this.findings = {
      test: [],           // Test-related findings
      security: [],       // Security vulnerabilities
      performance: [],    // Performance issues
      architecture: []    // Architecture/design issues
    };

    // Synthesis of all findings
    this.synthesis = {
      aggregated: [],     // All findings combined
      conflicts: [],      // Conflicting recommendations
      decision: null,     // Final approval decision
      rationale: null     // Reasoning for decision
    };

    // Output generation
    this.output = {
      comments: [],       // Inline code comments
      summary: null,      // Review summary text
      status: null        // Final status (success/failure)
    };

    // State management
    this.phase = 'initializing';       // Current phase of review
    this.currentPhase = 'initializing'; // Alias for compatibility
    this.checkpoints = [];              // Phase transition history
    this.errors = [];                   // Errors encountered during review
    this.timestamp = new Date();        // Creation timestamp
  }

  /**
   * Transition to a new phase and save checkpoint
   * @param {string} newPhase - The phase to transition to
   * @throws {Error} If phase is invalid
   */
  transitionTo(newPhase) {
    if (!newPhase || typeof newPhase !== 'string') {
      throw new Error('Invalid phase: phase must be a non-empty string');
    }

    const validPhases = [
      'initializing',
      'context_gathering',
      'review',
      'parallel_analysis',  // New phase for sub-agents
      'synthesis',
      'output',
      'completed',
      'failed'
    ];

    if (!validPhases.includes(newPhase)) {
      throw new Error(`Invalid phase: ${newPhase}. Must be one of: ${validPhases.join(', ')}`);
    }

    // Save checkpoint
    this.checkpoints.push({
      fromPhase: this.phase,
      toPhase: newPhase,
      timestamp: new Date()
    });

    // Update phase
    this.phase = newPhase;
    this.currentPhase = newPhase;  // Keep alias in sync
  }

  /**
   * Add an error with phase context
   * @param {string} phase - The phase where error occurred
   * @param {Error|string} error - The error to log
   */
  addError(phase, error) {
    this.errors.push({
      phase,
      error,
      timestamp: new Date()
    });
  }

  /**
   * Convert ReviewState to JSON-serializable object
   * Handles Date objects and Error instances
   */
  toJSON() {
    return {
      prId: this.prId,
      iid: this.iid,
      platform: this.platform,
      repository: this.repository,
      branch: this.branch,
      baseBranch: this.baseBranch,
      context: this.context,
      findings: this.findings,
      synthesis: this.synthesis,
      output: this.output,
      phase: this.phase,
      checkpoints: this.checkpoints,
      errors: this.errors.map(e => ({
        phase: e.phase,
        error: e.error instanceof Error ? e.error.message : e.error,
        timestamp: e.timestamp
      })),
      timestamp: this.timestamp
    };
  }

  /**
   * Create ReviewState from JSON object
   * @param {Object} json - JSON object to deserialize
   * @returns {ReviewState} New ReviewState instance
   */
  static fromJSON(json) {
    const state = new ReviewState(
      json.prId,
      json.platform,
      json.repository,
      json.branch,
      json.baseBranch,
      json.iid
    );

    // Restore all properties
    state.context = json.context || state.context;
    state.findings = json.findings || state.findings;
    state.synthesis = json.synthesis || state.synthesis;
    state.output = json.output || state.output;
    state.phase = json.phase || state.phase;
    state.currentPhase = json.currentPhase || json.phase || state.phase;  // Sync alias
    state.checkpoints = json.checkpoints || state.checkpoints;
    state.errors = json.errors || state.errors;
    state.timestamp = json.timestamp ? new Date(json.timestamp) : state.timestamp;

    return state;
  }
}

export default ReviewState;