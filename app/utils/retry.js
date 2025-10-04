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

      // Calculate delay with exponential backoff and jitter
      const delay = calculateDelay(attempt, config);

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

