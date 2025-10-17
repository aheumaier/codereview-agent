/**
 * Token Budget Manager
 * Tracks token usage per PR and per agent
 * Prevents runaway costs
 */

/**
 * Custom error for budget exceeded scenarios
 */
export class TokenBudgetExceededError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TokenBudgetExceededError';
  }
}

/**
 * Manages token budget for a single PR review
 * Tracks usage per agent and enforces limits
 */
export class TokenBudgetManager {
  /**
   * Initialize budget manager
   * @param {number} maxTokens - Maximum tokens allowed for PR
   */
  constructor(maxTokens) {
    if (!maxTokens || maxTokens <= 0) {
      throw new Error('maxTokens must be a positive number');
    }

    this.maxTokens = maxTokens;
    this.usedTokens = 0;
    this.agentUsage = new Map();
    this.callHistory = [];
    this.startTime = Date.now();
  }

  /**
   * Track API call and update usage
   * @param {string} agentName - Agent identifier
   * @param {Function} apiCall - Async function making API call
   * @param {number} estimatedTokens - Pre-flight token estimate
   * @returns {Promise<Object>} API response with usage tracking
   * @throws {TokenBudgetExceededError} If budget would be exceeded
   */
  async trackCall(agentName, apiCall, estimatedTokens = 0) {
    if (!agentName) {
      throw new Error('agentName is required');
    }

    if (typeof apiCall !== 'function') {
      throw new Error('apiCall must be a function');
    }

    // Pre-flight budget check with safety margin (20% buffer)
    const safetyMargin = 1.2;
    const projectedUsage = this.usedTokens + (estimatedTokens * safetyMargin);

    if (projectedUsage > this.maxTokens) {
      const error = new TokenBudgetExceededError(
        `Would exceed budget: ${projectedUsage.toFixed(0)}/${this.maxTokens} tokens (${agentName})`
      );
      console.error(`[TokenBudget] ${error.message}`);
      throw error;
    }

    const callStart = Date.now();
    const startTokens = this.usedTokens;

    try {
      console.debug(`[TokenBudget] ${agentName}: Starting call (estimated: ${estimatedTokens} tokens)`);

      const response = await apiCall();

      // Extract token usage from response
      const actualTokens = this.extractTokenUsage(response);

      // Update totals
      this.usedTokens += actualTokens;

      // Update agent-specific usage
      const currentAgentUsage = this.agentUsage.get(agentName) || 0;
      this.agentUsage.set(agentName, currentAgentUsage + actualTokens);

      // Record call history
      this.callHistory.push({
        agentName,
        timestamp: callStart,
        duration: Date.now() - callStart,
        estimatedTokens,
        actualTokens,
        totalAfter: this.usedTokens
      });

      console.log(`[TokenBudget] ${agentName}: ${actualTokens} tokens used (${this.getPercentUsed()}% of budget)`);

      return response;
    } catch (error) {
      // Rollback on failure to maintain accurate count
      this.usedTokens = startTokens;

      console.error(`[TokenBudget] ${agentName}: Call failed, rolled back token count`);
      throw error;
    }
  }

  /**
   * Extract token usage from API response
   * @param {Object} response - API response
   * @returns {number} Total tokens used
   */
  extractTokenUsage(response) {
    // Handle Claude SDK response format
    if (response?.usage) {
      const inputTokens = response.usage.input_tokens || 0;
      const outputTokens = response.usage.output_tokens || 0;
      return inputTokens + outputTokens;
    }

    // Handle wrapped response
    if (response?.data?.usage) {
      const inputTokens = response.data.usage.input_tokens || 0;
      const outputTokens = response.data.usage.output_tokens || 0;
      return inputTokens + outputTokens;
    }

    // Fallback: warn and return conservative estimate
    console.warn('[TokenBudget] Unable to extract token usage from response, using fallback');
    return 1000;
  }

  /**
   * Get remaining budget
   * @returns {number} Remaining tokens
   */
  getRemainingBudget() {
    return Math.max(0, this.maxTokens - this.usedTokens);
  }

  /**
   * Get percentage of budget used
   * @returns {string} Percentage used (formatted)
   */
  getPercentUsed() {
    return ((this.usedTokens / this.maxTokens) * 100).toFixed(1);
  }

  /**
   * Check if budget allows for more calls
   * @param {number} estimatedTokens - Estimated tokens for next call
   * @returns {boolean} True if budget allows
   */
  canAfford(estimatedTokens) {
    return (this.usedTokens + estimatedTokens) <= this.maxTokens;
  }

  /**
   * Get detailed usage report
   * @returns {Object} Comprehensive usage statistics
   */
  getReport() {
    const duration = Date.now() - this.startTime;
    const durationSeconds = duration / 1000;

    // Calculate agent statistics
    const agentStats = {};
    for (const [agent, tokens] of this.agentUsage) {
      agentStats[agent] = {
        tokens,
        percentage: ((tokens / this.usedTokens) * 100).toFixed(1) + '%',
        calls: this.callHistory.filter(c => c.agentName === agent).length
      };
    }

    return {
      maxTokens: this.maxTokens,
      usedTokens: this.usedTokens,
      remainingTokens: this.getRemainingBudget(),
      percentUsed: this.getPercentUsed() + '%',
      durationMs: duration,
      durationSeconds: durationSeconds.toFixed(1),
      tokensPerSecond: durationSeconds > 0 ? (this.usedTokens / durationSeconds).toFixed(2) : '0',
      totalCalls: this.callHistory.length,
      agentBreakdown: agentStats,
      averageTokensPerCall: this.callHistory.length > 0
        ? Math.round(this.usedTokens / this.callHistory.length)
        : 0,
      peakUsageAgent: this.getPeakUsageAgent()
    };
  }

  /**
   * Get agent with highest token usage
   * @returns {Object|null} Agent name and usage
   */
  getPeakUsageAgent() {
    if (this.agentUsage.size === 0) return null;

    let peakAgent = null;
    let peakUsage = 0;

    for (const [agent, tokens] of this.agentUsage) {
      if (tokens > peakUsage) {
        peakUsage = tokens;
        peakAgent = agent;
      }
    }

    return {
      name: peakAgent,
      tokens: peakUsage,
      percentage: ((peakUsage / this.usedTokens) * 100).toFixed(1) + '%'
    };
  }

  /**
   * Reset budget manager to initial state
   */
  reset() {
    this.usedTokens = 0;
    this.agentUsage.clear();
    this.callHistory = [];
    this.startTime = Date.now();
    console.debug('[TokenBudget] Reset to initial state');
  }

  /**
   * Export usage data for persistence
   * @returns {Object} Serializable usage data
   */
  export() {
    return {
      maxTokens: this.maxTokens,
      usedTokens: this.usedTokens,
      agentUsage: Object.fromEntries(this.agentUsage),
      startTime: this.startTime,
      callCount: this.callHistory.length
    };
  }

  /**
   * Import usage data from persistence
   * @param {Object} data - Previously exported data
   */
  import(data) {
    if (!data) return;

    this.maxTokens = data.maxTokens || this.maxTokens;
    this.usedTokens = data.usedTokens || 0;
    this.startTime = data.startTime || Date.now();

    if (data.agentUsage) {
      this.agentUsage = new Map(Object.entries(data.agentUsage));
    }

    console.debug(`[TokenBudget] Imported state: ${this.usedTokens}/${this.maxTokens} tokens used`);
  }
}

export default TokenBudgetManager;