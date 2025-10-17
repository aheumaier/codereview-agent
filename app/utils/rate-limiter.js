/**
 * Token Bucket Rate Limiter
 * Simulates Anthropic's token bucket algorithm client-side
 * Prevents 429 errors through proactive throttling
 */

/**
 * Token bucket implementation for rate limiting
 * Uses continuous refill model matching Claude API's behavior
 */
export class TokenBucketRateLimiter {
  /**
   * Initialize token bucket
   * @param {number} capacity - Maximum tokens in bucket
   * @param {number} refillRate - Tokens refilled per second
   */
  constructor(capacity, refillRate) {
    this.capacity = capacity;        // Max tokens (e.g., 30000 for ITPM)
    this.tokens = capacity;          // Current available tokens
    this.refillRate = refillRate;    // Tokens per second (e.g., 500 for ITPM)
    this.lastRefill = Date.now();
  }

  /**
   * Acquire tokens from bucket (wait if insufficient)
   * @param {number} tokensNeeded - Number of tokens to acquire
   * @returns {Promise<void>} Resolves when tokens acquired
   * @throws {Error} If tokens exceed capacity
   */
  async acquire(tokensNeeded) {
    if (tokensNeeded > this.capacity) {
      throw new Error(`Requested ${tokensNeeded} tokens exceeds bucket capacity ${this.capacity}`);
    }

    // Refill based on elapsed time
    this.refill();

    // If we have enough tokens, consume immediately
    if (this.tokens >= tokensNeeded) {
      this.tokens -= tokensNeeded;
      console.debug(`[RateLimiter] Acquired ${tokensNeeded} tokens, ${Math.floor(this.tokens)} remaining`);
      return;
    }

    // Calculate wait time needed
    const tokensShort = tokensNeeded - this.tokens;
    const waitTimeMs = Math.ceil((tokensShort / this.refillRate) * 1000);

    console.debug(`[RateLimiter] Waiting ${waitTimeMs}ms for ${tokensNeeded} tokens`);

    // Wait for tokens to refill
    await this.sleep(waitTimeMs);

    // Refill and consume
    this.refill();
    this.tokens -= tokensNeeded;
  }

  /**
   * Refill bucket based on elapsed time
   * Uses continuous refill model (not fixed windows)
   */
  refill() {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefill) / 1000;

    if (elapsedSeconds > 0) {
      const tokensToAdd = elapsedSeconds * this.refillRate;
      this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
      this.lastRefill = now;

      console.debug(`[RateLimiter] Refilled ${tokensToAdd.toFixed(2)} tokens, now at ${this.tokens.toFixed(2)}/${this.capacity}`);
    }
  }

  /**
   * Get current available tokens (with refill)
   * @returns {number} Available tokens
   */
  getAvailableTokens() {
    this.refill();
    return this.tokens;
  }

  /**
   * Check if tokens are available without consuming
   * @param {number} tokensNeeded - Tokens to check
   * @returns {boolean} True if tokens available
   */
  canAcquireNow(tokensNeeded) {
    this.refill();
    return this.tokens >= tokensNeeded;
  }

  /**
   * Reset bucket to full capacity
   */
  reset() {
    this.tokens = this.capacity;
    this.lastRefill = Date.now();
    console.debug(`[RateLimiter] Reset to full capacity: ${this.capacity}`);
  }

  /**
   * Sleep helper
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Factory to create rate limiters for all Claude API metrics
 * @param {Object} config - Application configuration
 * @returns {Object} Rate limiters for RPM, ITPM, OTPM
 */
export function createRateLimiters(config) {
  const tier = config.claude?.tier || 1;

  // Claude API tier limits
  const limits = {
    1: { rpm: 50, itpm: 30000, otpm: 8000 },
    2: { rpm: 100, itpm: 60000, otpm: 16000 },
    3: { rpm: 300, itpm: 150000, otpm: 40000 },
    4: { rpm: 500, itpm: 300000, otpm: 80000 }
  }[tier];

  if (!limits) {
    throw new Error(`Invalid Claude API tier: ${tier}. Must be 1-4.`);
  }

  console.log(`[RateLimiter] Initializing for Claude Tier ${tier}: RPM=${limits.rpm}, ITPM=${limits.itpm}, OTPM=${limits.otpm}`);

  return {
    rpm: new TokenBucketRateLimiter(limits.rpm, limits.rpm / 60),
    itpm: new TokenBucketRateLimiter(limits.itpm, limits.itpm / 60),
    otpm: new TokenBucketRateLimiter(limits.otpm, limits.otpm / 60)
  };
}

/**
 * Estimate token count from text
 * Uses Claude's approximation: 1 token ≈ 4 characters
 * @param {string} text - Text to estimate
 * @returns {number} Estimated token count
 */
export function estimateTokens(text) {
  if (!text) return 0;

  // Claude approximation: 1 token ≈ 4 characters
  // Add 10% buffer for safety
  const estimate = Math.ceil((text.length / 4) * 1.1);

  console.debug(`[RateLimiter] Estimated ${estimate} tokens for ${text.length} chars`);
  return estimate;
}

/**
 * Estimate tokens for structured data (JSON)
 * @param {Object} data - Data object to estimate
 * @returns {number} Estimated token count
 */
export function estimateTokensFromObject(data) {
  if (!data) return 0;

  try {
    const jsonString = JSON.stringify(data);
    return estimateTokens(jsonString);
  } catch (error) {
    console.warn('[RateLimiter] Failed to estimate tokens from object:', error);
    return 1000; // Conservative fallback
  }
}

export default TokenBucketRateLimiter;