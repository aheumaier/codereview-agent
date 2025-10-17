/**
 * Retry utility with exponential backoff
 * Following SOLID principles and Clean Code practices
 */

import { PlatformError, MCPError } from './errorHelpers.js';

/**
 * Default retry configuration
 * Single Responsibility: Configuration management
 */
const DEFAULT_RETRY_CONFIG = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 32000,
  backoffMultiplier: 2,
  jitterFactor: 0.2
};

/**
 * Network error codes that should be retried
 */
const RETRYABLE_ERROR_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNREFUSED',
  'EPIPE',
  'EHOSTUNREACH',
  'EAI_AGAIN',
  'ENETUNREACH',
  'ECONNABORTED'
]);

/**
 * HTTP status codes that should be retried
 */
const RETRYABLE_HTTP_STATUSES = new Set([
  408, // Request Timeout
  429, // Too Many Requests
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
  509, // Bandwidth Limit Exceeded
  520, // Unknown Error (Cloudflare)
  521, // Web Server Is Down (Cloudflare)
  522, // Connection Timed Out (Cloudflare)
  523, // Origin Is Unreachable (Cloudflare)
  524, // A Timeout Occurred (Cloudflare)
  525, // SSL Handshake Failed (Cloudflare)
  527, // Railgun Error (Cloudflare)
  529  // Site is overloaded
]);

/**
 * Determine if an error is retryable
 * @param {Error} error - Error to check
 * @returns {boolean} True if error should be retried
 */
export function isRetryableError(error) {
  if (!error) return false;

  // Check network error codes
  if (error.code && RETRYABLE_ERROR_CODES.has(error.code)) {
    return true;
  }

  // Check HTTP status codes
  if (error.statusCode && RETRYABLE_HTTP_STATUSES.has(error.statusCode)) {
    return true;
  }

  // Also check error.status (some libraries use this)
  if (error.status && RETRYABLE_HTTP_STATUSES.has(error.status)) {
    return true;
  }

  // Check PlatformError status codes
  if (error instanceof PlatformError && error.statusCode) {
    return RETRYABLE_HTTP_STATUSES.has(error.statusCode);
  }

  // Check MCPError - usually network-related
  if (error instanceof MCPError) {
    // Check if the underlying cause is retryable
    if (error.cause) {
      return isRetryableError(error.cause);
    }
    // MCPErrors without a cause might be transient
    return true;
  }

  // Check for fetch Response errors
  if (error.response?.status) {
    return RETRYABLE_HTTP_STATUSES.has(error.response.status);
  }

  // Check error message for common retryable patterns
  const errorMessage = error.message?.toLowerCase() || '';
  const retryablePatterns = [
    'timeout',
    'timed out',
    'network',
    'econnreset',
    'socket hang up',
    'rate limit',
    'too many requests',
    'service unavailable',
    'gateway',
    'overloaded'
  ];

  return retryablePatterns.some(pattern => errorMessage.includes(pattern));
}

/**
 * Calculate exponential backoff delay with jitter
 * @param {number} attempt - Current attempt number (0-based)
 * @param {Object} options - Retry options
 * @returns {number} Delay in milliseconds
 */
export function calculateDelay(attempt, options = {}) {
  const config = { ...DEFAULT_RETRY_CONFIG, ...options };

  // Calculate base exponential delay
  const baseDelay = Math.min(
    config.initialDelay * Math.pow(config.backoffMultiplier, attempt),
    config.maxDelay
  );

  // Add jitter (±20% by default) to prevent thundering herd
  const jitter = baseDelay * config.jitterFactor;
  const randomJitter = (Math.random() - 0.5) * 2 * jitter;

  return Math.round(Math.max(0, baseDelay + randomJitter));
}

/**
 * Extract retry-after header value
 * @param {Error} error - Error object that may contain headers
 * @returns {number|null} Delay in milliseconds, or null if not found
 */
export function extractRetryAfter(error) {
  // Check various header locations
  const headers = error.headers || error.response?.headers;
  if (!headers) return null;

  // Get retry-after value (case-insensitive)
  let retryAfter;
  if (typeof headers.get === 'function') {
    retryAfter = headers.get('retry-after');
  } else if (typeof headers === 'object') {
    retryAfter = headers['retry-after'] || headers['Retry-After'] || headers['RETRY-AFTER'];
  }

  if (!retryAfter) return null;

  // Parse as seconds and convert to milliseconds
  const seconds = parseInt(retryAfter, 10);
  if (!isNaN(seconds) && seconds > 0) {
    return seconds * 1000;
  }

  // Could be a date string (HTTP-date format)
  const retryDate = new Date(retryAfter);
  if (!isNaN(retryDate.getTime())) {
    const now = Date.now();
    const delay = retryDate.getTime() - now;
    return delay > 0 ? delay : null;
  }

  return null;
}

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>} Promise that resolves after delay
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry an async function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry configuration options
 * @returns {Promise<any>} Result of successful function call
 * @throws {Error} Last error if all retries exhausted
 */
export async function retryWithBackoff(fn, options = {}) {
  const config = { ...DEFAULT_RETRY_CONFIG, ...options };

  // Validate inputs
  if (typeof fn !== 'function') {
    throw new TypeError('First argument must be a function');
  }

  if (config.maxRetries < 0) {
    throw new RangeError('maxRetries must be non-negative');
  }

  let lastError;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      // Execute the function
      const result = await fn();

      // Success - return result
      return result;

    } catch (error) {
      lastError = error;

      // Check if this is the last attempt
      if (attempt === config.maxRetries) {
        // Exhausted all retries
        break;
      }

      // Check if error is retryable
      const shouldRetry = config.shouldRetry
        ? config.shouldRetry(error)
        : isRetryableError(error);

      if (!shouldRetry) {
        // Error is not retryable, fail immediately
        throw error;
      }

      // Handle 429 with retry-after header (NEW)
      const retryAfterDelay = extractRetryAfter(error);
      let delay;

      if (retryAfterDelay !== null) {
        // Use retry-after header value
        delay = retryAfterDelay;
        console.log(`[Retry] Rate limited. Waiting ${delay}ms (from retry-after header)`);
      } else {
        // Calculate delay with exponential backoff and jitter
        delay = calculateDelay(attempt, config);
        console.debug(`[Retry] Attempt ${attempt + 1}/${config.maxRetries + 1} after ${delay.toFixed(0)}ms`);
      }

      // Call onRetry callback if provided
      if (config.onRetry) {
        config.onRetry(error, attempt + 1, delay);
      }

      // Wait before next attempt
      await sleep(delay);
    }
  }

  // All retries exhausted, throw last error
  throw lastError;
}

/**
 * Enhanced retry wrapper with full jitter and retry-after support
 * Backward compatible with existing withRetry usage
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry configuration options
 * @returns {Promise<any>} Result of successful function call
 * @throws {Error} Last error if all retries exhausted
 */
export async function withRetry(fn, options = {}) {
  const {
    maxRetries = 5,
    baseDelay = 1000,
    maxDelay = 60000,
    jitterPercent = 0.1,
    shouldRetry = isRetryableError
  } = options;

  // Map to retryWithBackoff config format
  const backoffConfig = {
    maxRetries,
    initialDelay: baseDelay,
    maxDelay,
    jitterFactor: jitterPercent,
    shouldRetry,
    backoffMultiplier: 2,
    onRetry: options.onRetry
  };

  return retryWithBackoff(fn, backoffConfig);
}

