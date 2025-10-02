/**
 * Error handling utilities and custom error classes
 * Following SOLID principles and Clean Code practices
 */

/**
 * Base error class for code review agent
 * Single Responsibility: Base error with cause tracking
 */
export class CodeReviewError extends Error {
  constructor(message, cause = null) {
    super(message);
    this.name = this.constructor.name;
    this.cause = cause;
    this.timestamp = new Date().toISOString();
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Get full error chain as array
   * @returns {Array<Error>} Chain of errors from root cause
   */
  getErrorChain() {
    const chain = [this];
    let current = this.cause;
    while (current) {
      chain.push(current);
      current = current.cause || null;
    }
    return chain;
  }

  /**
   * Get formatted error message with cause chain
   * @returns {string} Formatted error message
   */
  getFullMessage() {
    const chain = this.getErrorChain();
    return chain.map((err, index) => {
      const prefix = index === 0 ? 'Error' : `Caused by`;
      return `${prefix}: ${err.message}`;
    }).join('\n  ');
  }
}

/**
 * Configuration or validation error
 * Single Responsibility: Config-specific errors
 */
export class ConfigurationError extends CodeReviewError {
  constructor(message, configKey = null, cause = null) {
    super(message, cause);
    this.configKey = configKey;
  }
}

/**
 * VCS platform API error (GitLab, GitHub, Bitbucket)
 * Single Responsibility: Platform-specific errors
 */
export class PlatformError extends CodeReviewError {
  constructor(message, platform, statusCode = null, cause = null) {
    super(message, cause);
    this.platform = platform;
    this.statusCode = statusCode;
  }
}

/**
 * MCP communication error
 * Single Responsibility: MCP protocol errors
 */
export class MCPError extends CodeReviewError {
  constructor(message, tool = null, cause = null) {
    super(message, cause);
    this.tool = tool;
  }
}

/**
 * Wrap unknown errors in CodeReviewError
 * Open/Closed Principle: Extend without modifying
 * @param {Error|string|any} error - Original error
 * @param {string} message - Context message
 * @returns {CodeReviewError} Wrapped error
 */
export function wrapError(error, message) {
  // Already a CodeReviewError, return as-is
  if (error instanceof CodeReviewError) {
    return error;
  }

  // Standard Error object
  if (error instanceof Error) {
    return new CodeReviewError(message, error);
  }

  // String error
  if (typeof error === 'string') {
    const stringError = new Error(error);
    return new CodeReviewError(message, stringError);
  }

  // Unknown error type
  const unknownError = new Error(String(error));
  return new CodeReviewError(message, unknownError);
}

/**
 * Check if error is a specific type
 * @param {Error} error - Error to check
 * @param {Function} errorClass - Error class to check against
 * @returns {boolean} True if error is instance of class
 */
export function isErrorType(error, errorClass) {
  return error instanceof errorClass;
}

/**
 * Extract error details for logging
 * @param {Error} error - Error to extract details from
 * @returns {Object} Error details object
 */
export function extractErrorDetails(error) {
  const details = {
    message: error.message,
    type: error.constructor.name,
    timestamp: new Date().toISOString()
  };

  if (error instanceof PlatformError) {
    details.platform = error.platform;
    details.statusCode = error.statusCode;
  } else if (error instanceof ConfigurationError) {
    details.configKey = error.configKey;
  } else if (error instanceof MCPError) {
    details.tool = error.tool;
  } else if (error instanceof CodeReviewError) {
    details.timestamp = error.timestamp;
  }

  if (error.cause) {
    details.cause = extractErrorDetails(error.cause);
  }

  if (error.stack) {
    details.stack = error.stack.split('\n').slice(0, 5).join('\n');
  }

  return details;
}

/**
 * Create platform-specific error with context
 * Factory pattern for platform errors
 * @param {string} platform - Platform name
 * @param {string} operation - Operation that failed
 * @param {Error} cause - Original error
 * @returns {PlatformError} Platform-specific error
 */
export function createPlatformError(platform, operation, cause = null) {
  const statusCode = cause?.response?.status || null;
  const message = `${platform} ${operation} failed${statusCode ? ` (${statusCode})` : ''}`;
  return new PlatformError(message, platform, statusCode, cause);
}

/**
 * Create configuration error with context
 * Factory pattern for configuration errors
 * @param {string} configKey - Configuration key
 * @param {string} requirement - What's required
 * @param {any} actualValue - Actual value found
 * @returns {ConfigurationError} Configuration error
 */
export function createConfigError(configKey, requirement, actualValue = undefined) {
  const message = actualValue !== undefined
    ? `Configuration '${configKey}' is invalid: ${requirement} (got: ${actualValue})`
    : `Configuration '${configKey}' is required: ${requirement}`;
  return new ConfigurationError(message, configKey);
}