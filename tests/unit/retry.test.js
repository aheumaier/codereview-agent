/**
 * Unit tests for retry utility module
 * Testing exponential backoff, retry logic, and circuit breaker
 */

import {
  retryWithBackoff,
  isRetryableError,
  calculateDelay,
  CircuitBreaker,
  withRetry
} from '../../app/utils/retry.js';
import { PlatformError, MCPError } from '../../app/utils/errorHelpers.js';

describe('Retry Utility', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('isRetryableError', () => {
    it('should return false for null/undefined errors', () => {
      expect(isRetryableError(null)).toBe(false);
      expect(isRetryableError(undefined)).toBe(false);
    });

    it('should return true for network error codes', () => {
      const networkErrors = [
        { code: 'ECONNRESET' },
        { code: 'ETIMEDOUT' },
        { code: 'ENOTFOUND' },
        { code: 'ECONNREFUSED' },
        { code: 'EPIPE' },
        { code: 'EHOSTUNREACH' }
      ];

      networkErrors.forEach(error => {
        expect(isRetryableError(error)).toBe(true);
      });
    });

    it('should return true for 5xx HTTP status codes', () => {
      const serverErrors = [
        { statusCode: 500 },
        { statusCode: 502 },
        { statusCode: 503 },
        { statusCode: 504 }
      ];

      serverErrors.forEach(error => {
        expect(isRetryableError(error)).toBe(true);
      });
    });

    it('should return true for rate limiting (429)', () => {
      expect(isRetryableError({ statusCode: 429 })).toBe(true);
    });

    it('should return true for timeout (408)', () => {
      expect(isRetryableError({ statusCode: 408 })).toBe(true);
    });

    it('should return false for 4xx client errors (except 408, 429)', () => {
      const clientErrors = [
        { statusCode: 400 },
        { statusCode: 401 },
        { statusCode: 403 },
        { statusCode: 404 },
        { statusCode: 405 }
      ];

      clientErrors.forEach(error => {
        expect(isRetryableError(error)).toBe(false);
      });
    });

    it('should handle PlatformError with status codes', () => {
      const retryablePlatformError = new PlatformError('API Error', 'gitlab', 503);
      expect(isRetryableError(retryablePlatformError)).toBe(true);

      const nonRetryablePlatformError = new PlatformError('Not Found', 'gitlab', 404);
      expect(isRetryableError(nonRetryablePlatformError)).toBe(false);
    });

    it('should handle MCPError with retryable cause', () => {
      const networkCause = new Error('Network error');
      networkCause.code = 'ECONNRESET';
      const mcpError = new MCPError('MCP failed', 'get_file', networkCause);
      expect(isRetryableError(mcpError)).toBe(true);
    });

    it('should handle MCPError without cause as retryable', () => {
      const mcpError = new MCPError('MCP failed', 'get_file');
      expect(isRetryableError(mcpError)).toBe(true);
    });

    it('should check error message for retryable patterns', () => {
      const retryableMessages = [
        new Error('Connection timeout'),
        new Error('Request timed out'),
        new Error('Network error'),
        new Error('ECONNRESET: socket hang up'),
        new Error('Rate limit exceeded'),
        new Error('Too many requests'),
        new Error('Service unavailable'),
        new Error('Bad gateway'),
        new Error('Server overloaded')
      ];

      retryableMessages.forEach(error => {
        expect(isRetryableError(error)).toBe(true);
      });
    });

    it('should handle fetch Response errors', () => {
      const retryableResponse = { response: { status: 503 } };
      expect(isRetryableError(retryableResponse)).toBe(true);

      const nonRetryableResponse = { response: { status: 400 } };
      expect(isRetryableError(nonRetryableResponse)).toBe(false);
    });
  });

  describe('calculateDelay', () => {
    it('should calculate exponential backoff correctly', () => {
      const options = {
        initialDelay: 1000,
        backoffMultiplier: 2,
        maxDelay: 32000,
        jitterFactor: 0
      };

      expect(calculateDelay(0, options)).toBe(1000);
      expect(calculateDelay(1, options)).toBe(2000);
      expect(calculateDelay(2, options)).toBe(4000);
      expect(calculateDelay(3, options)).toBe(8000);
      expect(calculateDelay(4, options)).toBe(16000);
      expect(calculateDelay(5, options)).toBe(32000);
      expect(calculateDelay(6, options)).toBe(32000); // Capped at maxDelay
    });

    it('should respect maxDelay cap', () => {
      const options = {
        initialDelay: 10000,
        backoffMultiplier: 3,
        maxDelay: 20000,
        jitterFactor: 0
      };

      expect(calculateDelay(0, options)).toBe(10000);
      expect(calculateDelay(1, options)).toBe(20000); // Would be 30000 but capped
      expect(calculateDelay(2, options)).toBe(20000); // Would be 90000 but capped
    });

    it('should add jitter to prevent thundering herd', () => {
      const options = {
        initialDelay: 1000,
        backoffMultiplier: 2,
        jitterFactor: 0.2
      };

      // Run multiple times to check jitter variation
      const delays = new Set();
      for (let i = 0; i < 20; i++) {
        delays.add(calculateDelay(1, options));
      }

      // Should have variation due to jitter
      expect(delays.size).toBeGreaterThan(1);

      // All delays should be within jitter range (2000 ± 20%)
      delays.forEach(delay => {
        expect(delay).toBeGreaterThanOrEqual(1600);
        expect(delay).toBeLessThanOrEqual(2400);
      });
    });

    it('should use default config when options not provided', () => {
      const delay = calculateDelay(0);
      expect(delay).toBeGreaterThanOrEqual(800); // 1000 - 20%
      expect(delay).toBeLessThanOrEqual(1200); // 1000 + 20%
    });
  });

  describe('retryWithBackoff', () => {
    it('should return result on successful first attempt', async () => {
      const mockFn = jest.fn().mockResolvedValue('success');

      const promise = retryWithBackoff(mockFn);

      // Immediately resolve without any timers
      const result = await promise;

      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable errors', async () => {
      const mockFn = jest.fn()
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockRejectedValueOnce({ statusCode: 503 })
        .mockResolvedValueOnce('success');

      const onRetry = jest.fn();
      const promise = retryWithBackoff(mockFn, {
        maxRetries: 3,
        initialDelay: 100,
        jitterFactor: 0,
        onRetry
      });

      // Run all timers to completion
      await jest.runAllTimersAsync();

      const result = await promise;

      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(3);
      expect(onRetry).toHaveBeenCalledTimes(2);
    });

    it('should not retry on non-retryable errors', async () => {
      const nonRetryableError = { statusCode: 404 };
      const mockFn = jest.fn().mockRejectedValue(nonRetryableError);

      await expect(retryWithBackoff(mockFn)).rejects.toEqual(nonRetryableError);
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it('should throw last error when max retries exhausted', async () => {
      // Use real timers for this test to avoid async issues
      jest.useRealTimers();

      const testError = { statusCode: 500, message: 'Server error' };
      const mockFn = jest.fn().mockRejectedValue(testError);

      const promise = retryWithBackoff(mockFn, {
        maxRetries: 2,
        initialDelay: 10,  // Short delay for real timers
        jitterFactor: 0
      });

      // Wait for the promise to resolve/reject
      await expect(promise).rejects.toEqual(testError);

      // Verify function was called expected number of times
      expect(mockFn).toHaveBeenCalledTimes(3); // Initial + 2 retries

      // Restore fake timers for other tests
      jest.useFakeTimers();
    });

    it('should use custom shouldRetry predicate', async () => {
      const customError = new Error('Custom error');
      const mockFn = jest.fn()
        .mockRejectedValueOnce(customError)
        .mockResolvedValueOnce('success');

      const shouldRetry = jest.fn().mockReturnValue(true);
      const promise = retryWithBackoff(mockFn, {
        shouldRetry,
        initialDelay: 100,
        jitterFactor: 0
      });

      await jest.runAllTimersAsync();

      const result = await promise;

      expect(result).toBe('success');
      expect(shouldRetry).toHaveBeenCalledWith(customError);
      expect(mockFn).toHaveBeenCalledTimes(2);
    });

    it('should call onRetry callback with correct parameters', async () => {
      const error = { statusCode: 503 };
      const mockFn = jest.fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce('success');

      const onRetry = jest.fn();
      const promise = retryWithBackoff(mockFn, {
        maxRetries: 3,
        initialDelay: 1000,
        jitterFactor: 0,
        onRetry
      });

      await jest.runAllTimersAsync();

      await promise;

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(error, 1, 1000);
    });

    it('should throw TypeError for non-function argument', async () => {
      await expect(retryWithBackoff('not a function')).rejects.toThrow(TypeError);
      await expect(retryWithBackoff(null)).rejects.toThrow(TypeError);
    });

    it('should throw RangeError for negative maxRetries', async () => {
      const mockFn = jest.fn();
      await expect(retryWithBackoff(mockFn, { maxRetries: -1 })).rejects.toThrow(RangeError);
    });

    it('should handle zero maxRetries (no retries)', async () => {
      const error = { statusCode: 503 };
      const mockFn = jest.fn().mockRejectedValue(error);

      await expect(retryWithBackoff(mockFn, { maxRetries: 0 })).rejects.toEqual(error);
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it('should apply exponential backoff delays', async () => {
      const mockFn = jest.fn()
        .mockRejectedValueOnce({ statusCode: 503 })
        .mockRejectedValueOnce({ statusCode: 503 })
        .mockRejectedValueOnce({ statusCode: 503 })
        .mockResolvedValueOnce('success');

      const delays = [];
      const onRetry = jest.fn((error, attempt, delay) => {
        delays.push(delay);
      });

      const promise = retryWithBackoff(mockFn, {
        maxRetries: 3,
        initialDelay: 100,
        backoffMultiplier: 2,
        jitterFactor: 0,
        onRetry
      });

      // Run all timers to completion
      await jest.runAllTimersAsync();

      await promise;

      expect(delays).toEqual([100, 200, 400]);
    });
  });

  describe('CircuitBreaker', () => {
    it('should start in closed state', () => {
      const breaker = new CircuitBreaker();
      expect(breaker.getState()).toBe('closed');
    });

    it('should execute function when closed', async () => {
      const breaker = new CircuitBreaker();
      const mockFn = jest.fn().mockResolvedValue('result');

      const result = await breaker.execute(mockFn);

      expect(result).toBe('result');
      expect(mockFn).toHaveBeenCalled();
    });

    it('should open circuit after threshold failures', async () => {
      const breaker = new CircuitBreaker({
        threshold: 0.5,
        windowSize: 4
      });

      const mockFn = jest.fn().mockRejectedValue(new Error('fail'));

      // Create failures
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(mockFn);
        } catch {}
      }

      expect(breaker.getState()).toBe('open');
    });

    it('should reject calls when circuit is open', async () => {
      const breaker = new CircuitBreaker({ cooldownPeriod: 1000 });
      breaker.state = 'open';
      breaker.lastFailureTime = Date.now();

      const mockFn = jest.fn();

      await expect(breaker.execute(mockFn)).rejects.toThrow('Circuit breaker is open');
      expect(mockFn).not.toHaveBeenCalled();
    });

    it('should transition to half-open after cooldown', async () => {
      const breaker = new CircuitBreaker({ cooldownPeriod: 1000 });
      breaker.state = 'open';
      breaker.lastFailureTime = Date.now() - 2000; // Past cooldown

      const mockFn = jest.fn().mockResolvedValue('success');
      const result = await breaker.execute(mockFn);

      expect(result).toBe('success');
      expect(breaker.getState()).toBe('closed');
    });

    it('should reset on success in half-open state', async () => {
      const breaker = new CircuitBreaker();
      breaker.state = 'half-open';

      const mockFn = jest.fn().mockResolvedValue('success');
      await breaker.execute(mockFn);

      expect(breaker.getState()).toBe('closed');
    });

    it('should maintain sliding window of calls', () => {
      const breaker = new CircuitBreaker({ windowSize: 3 });

      breaker.recordSuccess();
      breaker.recordSuccess();
      breaker.recordFailure();
      breaker.recordFailure();

      expect(breaker.callHistory.length).toBe(3);
      expect(breaker.callHistory).toEqual([true, false, false]);
    });

    it('should reset to initial state', () => {
      const breaker = new CircuitBreaker();
      breaker.state = 'open';
      breaker.failures = 5;
      breaker.successes = 10;
      breaker.callHistory = [true, false, true];

      breaker.reset();

      expect(breaker.getState()).toBe('closed');
      expect(breaker.failures).toBe(0);
      expect(breaker.successes).toBe(0);
      expect(breaker.callHistory).toEqual([]);
    });
  });

  describe('withRetry', () => {
    it('should create a wrapped function with retry logic', async () => {
      const originalFn = jest.fn()
        .mockRejectedValueOnce({ statusCode: 503 })
        .mockResolvedValueOnce('success');

      const wrappedFn = withRetry(originalFn, {
        maxRetries: 2,
        initialDelay: 100,
        jitterFactor: 0
      });

      const promise = wrappedFn('arg1', 'arg2');

      await jest.runAllTimersAsync();

      const result = await promise;

      expect(result).toBe('success');
      expect(originalFn).toHaveBeenCalledTimes(2);
      expect(originalFn).toHaveBeenCalledWith('arg1', 'arg2');
    });

    it('should preserve function arguments', async () => {
      const originalFn = jest.fn().mockResolvedValue('result');
      const wrappedFn = withRetry(originalFn);

      await wrappedFn('a', 'b', 'c', { d: 1 });

      expect(originalFn).toHaveBeenCalledWith('a', 'b', 'c', { d: 1 });
    });
  });
});