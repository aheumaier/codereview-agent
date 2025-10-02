import {
  CodeReviewError,
  ConfigurationError,
  PlatformError,
  MCPError,
  wrapError,
  isErrorType,
  extractErrorDetails,
  createPlatformError,
  createConfigError
} from '../../app/utils/errorHelpers.js';

describe('Error Helpers', () => {
  describe('CodeReviewError', () => {
    it('should create base error with message', () => {
      const error = new CodeReviewError('Test error');
      expect(error.message).toBe('Test error');
      expect(error.name).toBe('CodeReviewError');
      expect(error.timestamp).toBeDefined();
      expect(error.cause).toBeNull();
    });

    it('should create error with cause', () => {
      const cause = new Error('Original error');
      const error = new CodeReviewError('Wrapped error', cause);
      expect(error.message).toBe('Wrapped error');
      expect(error.cause).toBe(cause);
    });

    it('should preserve stack trace', () => {
      const error = new CodeReviewError('Stack test');
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('CodeReviewError');
      expect(error.stack).toContain('Stack test');
    });

    it('should get error chain', () => {
      const root = new Error('Root cause');
      const middle = new CodeReviewError('Middle error', root);
      const top = new CodeReviewError('Top error', middle);

      const chain = top.getErrorChain();
      expect(chain).toHaveLength(3);
      expect(chain[0]).toBe(top);
      expect(chain[1]).toBe(middle);
      expect(chain[2]).toBe(root);
    });

    it('should format full message with cause chain', () => {
      const root = new Error('Database connection failed');
      const middle = new PlatformError('API call failed', 'gitlab', 500, root);
      const top = new CodeReviewError('Review failed', middle);

      const fullMessage = top.getFullMessage();
      expect(fullMessage).toContain('Error: Review failed');
      expect(fullMessage).toContain('Caused by: API call failed');
      expect(fullMessage).toContain('Caused by: Database connection failed');
    });
  });

  describe('ConfigurationError', () => {
    it('should create configuration error with config key', () => {
      const error = new ConfigurationError('Invalid config', 'api.key');
      expect(error.message).toBe('Invalid config');
      expect(error.name).toBe('ConfigurationError');
      expect(error.configKey).toBe('api.key');
    });

    it('should inherit from CodeReviewError', () => {
      const error = new ConfigurationError('Test');
      expect(error).toBeInstanceOf(CodeReviewError);
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('PlatformError', () => {
    it('should create platform error with all properties', () => {
      const cause = new Error('Network timeout');
      const error = new PlatformError('GitLab API failed', 'gitlab', 503, cause);

      expect(error.message).toBe('GitLab API failed');
      expect(error.name).toBe('PlatformError');
      expect(error.platform).toBe('gitlab');
      expect(error.statusCode).toBe(503);
      expect(error.cause).toBe(cause);
    });

    it('should work without status code', () => {
      const error = new PlatformError('GitHub error', 'github');
      expect(error.platform).toBe('github');
      expect(error.statusCode).toBeNull();
    });
  });

  describe('MCPError', () => {
    it('should create MCP error with tool name', () => {
      const error = new MCPError('MCP failed', 'list_merge_requests');
      expect(error.message).toBe('MCP failed');
      expect(error.name).toBe('MCPError');
      expect(error.tool).toBe('list_merge_requests');
    });

    it('should work without tool name', () => {
      const error = new MCPError('Connection failed');
      expect(error.tool).toBeNull();
    });
  });

  describe('wrapError', () => {
    it('should return CodeReviewError as-is', () => {
      const original = new CodeReviewError('Original');
      const wrapped = wrapError(original, 'Wrapper message');
      expect(wrapped).toBe(original);
    });

    it('should wrap standard Error', () => {
      const original = new Error('Standard error');
      const wrapped = wrapError(original, 'Operation failed');

      expect(wrapped).toBeInstanceOf(CodeReviewError);
      expect(wrapped.message).toBe('Operation failed');
      expect(wrapped.cause).toBe(original);
    });

    it('should wrap string error', () => {
      const wrapped = wrapError('String error', 'Operation failed');

      expect(wrapped).toBeInstanceOf(CodeReviewError);
      expect(wrapped.message).toBe('Operation failed');
      expect(wrapped.cause).toBeInstanceOf(Error);
      expect(wrapped.cause.message).toBe('String error');
    });

    it('should wrap unknown error types', () => {
      const wrapped = wrapError({ code: 'ERR_001' }, 'Operation failed');

      expect(wrapped).toBeInstanceOf(CodeReviewError);
      expect(wrapped.message).toBe('Operation failed');
      expect(wrapped.cause.message).toBe('[object Object]');
    });

    it('should wrap null/undefined errors', () => {
      const wrappedNull = wrapError(null, 'Null error');
      const wrappedUndef = wrapError(undefined, 'Undefined error');

      expect(wrappedNull).toBeInstanceOf(CodeReviewError);
      expect(wrappedUndef).toBeInstanceOf(CodeReviewError);
    });
  });

  describe('isErrorType', () => {
    it('should correctly identify error types', () => {
      const codeError = new CodeReviewError('Test');
      const configError = new ConfigurationError('Test');
      const platformError = new PlatformError('Test', 'gitlab');
      const mcpError = new MCPError('Test');
      const standardError = new Error('Test');

      expect(isErrorType(codeError, CodeReviewError)).toBe(true);
      expect(isErrorType(configError, ConfigurationError)).toBe(true);
      expect(isErrorType(configError, CodeReviewError)).toBe(true);
      expect(isErrorType(platformError, PlatformError)).toBe(true);
      expect(isErrorType(mcpError, MCPError)).toBe(true);

      expect(isErrorType(standardError, CodeReviewError)).toBe(false);
      expect(isErrorType(codeError, Error)).toBe(true);
    });
  });

  describe('extractErrorDetails', () => {
    it('should extract basic error details', () => {
      const error = new Error('Basic error');
      const details = extractErrorDetails(error);

      expect(details.message).toBe('Basic error');
      expect(details.type).toBe('Error');
      expect(details.timestamp).toBeDefined();
      expect(details.stack).toBeDefined();
    });

    it('should extract PlatformError details', () => {
      const error = new PlatformError('API failed', 'github', 404);
      const details = extractErrorDetails(error);

      expect(details.message).toBe('API failed');
      expect(details.type).toBe('PlatformError');
      expect(details.platform).toBe('github');
      expect(details.statusCode).toBe(404);
    });

    it('should extract ConfigurationError details', () => {
      const error = new ConfigurationError('Invalid', 'db.host');
      const details = extractErrorDetails(error);

      expect(details.configKey).toBe('db.host');
    });

    it('should extract MCPError details', () => {
      const error = new MCPError('Failed', 'get_file');
      const details = extractErrorDetails(error);

      expect(details.tool).toBe('get_file');
    });

    it('should extract nested error details', () => {
      const root = new Error('Root');
      const wrapped = new CodeReviewError('Wrapped', root);
      const details = extractErrorDetails(wrapped);

      expect(details.cause).toBeDefined();
      expect(details.cause.message).toBe('Root');
      expect(details.cause.type).toBe('Error');
    });

    it('should limit stack trace lines', () => {
      const error = new Error('Test');
      const details = extractErrorDetails(error);
      const stackLines = details.stack.split('\n');

      expect(stackLines.length).toBeLessThanOrEqual(5);
    });
  });

  describe('createPlatformError', () => {
    it('should create platform error with operation context', () => {
      const cause = new Error('Network error');
      const error = createPlatformError('GitLab', 'merge request fetch', cause);

      expect(error).toBeInstanceOf(PlatformError);
      expect(error.message).toBe('GitLab merge request fetch failed');
      expect(error.platform).toBe('GitLab');
      expect(error.cause).toBe(cause);
    });

    it('should include status code from response', () => {
      const cause = { response: { status: 401 } };
      const error = createPlatformError('GitHub', 'authentication', cause);

      expect(error.message).toBe('GitHub authentication failed (401)');
      expect(error.statusCode).toBe(401);
    });

    it('should work without cause', () => {
      const error = createPlatformError('Bitbucket', 'connection');

      expect(error.message).toBe('Bitbucket connection failed');
      expect(error.cause).toBeNull();
    });
  });

  describe('createConfigError', () => {
    it('should create config error for missing value', () => {
      const error = createConfigError('api.key', 'API key must be provided');

      expect(error).toBeInstanceOf(ConfigurationError);
      expect(error.message).toBe("Configuration 'api.key' is required: API key must be provided");
      expect(error.configKey).toBe('api.key');
    });

    it('should create config error for invalid value', () => {
      const error = createConfigError('port', 'must be a number', 'abc');

      expect(error.message).toBe("Configuration 'port' is invalid: must be a number (got: abc)");
      expect(error.configKey).toBe('port');
    });

    it('should handle undefined actual value differently', () => {
      const error = createConfigError('db.host', 'hostname required', undefined);

      expect(error.message).toBe("Configuration 'db.host' is required: hostname required");
    });
  });

  describe('Error inheritance chain', () => {
    it('should maintain proper inheritance', () => {
      const configError = new ConfigurationError('Test');
      const platformError = new PlatformError('Test', 'gitlab');
      const mcpError = new MCPError('Test');

      // All should inherit from CodeReviewError
      expect(configError).toBeInstanceOf(CodeReviewError);
      expect(platformError).toBeInstanceOf(CodeReviewError);
      expect(mcpError).toBeInstanceOf(CodeReviewError);

      // All should inherit from Error
      expect(configError).toBeInstanceOf(Error);
      expect(platformError).toBeInstanceOf(Error);
      expect(mcpError).toBeInstanceOf(Error);

      // Should not cross-inherit
      expect(configError).not.toBeInstanceOf(PlatformError);
      expect(platformError).not.toBeInstanceOf(ConfigurationError);
      expect(mcpError).not.toBeInstanceOf(PlatformError);
    });
  });

  describe('Error serialization', () => {
    it('should be serializable to JSON', () => {
      const error = new PlatformError('Test error', 'gitlab', 500);
      const serialized = JSON.stringify(extractErrorDetails(error));
      const parsed = JSON.parse(serialized);

      expect(parsed.message).toBe('Test error');
      expect(parsed.platform).toBe('gitlab');
      expect(parsed.statusCode).toBe(500);
    });
  });
});