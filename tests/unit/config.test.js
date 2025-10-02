import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';

describe('Config Module', () => {
  let config;
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('loadConfig', () => {
    it('should load config.json from conf directory', async () => {
      const { loadConfig } = await import('../../app/config.js');
      const configData = await loadConfig();

      expect(configData).toBeDefined();
      expect(configData.review).toBeDefined();
      expect(configData.platforms).toBeDefined();
      expect(configData.claude).toBeDefined();
    });

    it('should expand environment variables in config', async () => {
      process.env.GITLAB_URL = 'https://gitlab.example.com';
      process.env.GITLAB_TOKEN = 'test-token-123';
      process.env.CLAUDE_API_KEY = 'sk-ant-test';
      process.env.DRY_RUN = 'false';

      const { loadConfig } = await import('../../app/config.js');
      const configData = await loadConfig();

      expect(configData.platforms.gitlab.url).toBe('https://gitlab.example.com');
      expect(configData.platforms.gitlab.token).toBe('test-token-123');
      expect(configData.claude.apiKey).toBe('sk-ant-test');
      expect(configData.output.dryRun).toBe(false);
    });

    it('should handle missing environment variables gracefully', async () => {
      delete process.env.GITLAB_URL;
      delete process.env.GITLAB_TOKEN;

      const { loadConfig } = await import('../../app/config.js');
      const configData = await loadConfig();

      expect(configData.platforms.gitlab.url).toBe('');
      expect(configData.platforms.gitlab.token).toBe('');
    });

    it('should convert string boolean values correctly', async () => {
      process.env.DRY_RUN = 'true';

      const { loadConfig } = await import('../../app/config.js');
      const configData = await loadConfig();

      expect(configData.output.dryRun).toBe(true);
    });

    it('should handle numeric environment variables', async () => {
      const { loadConfig } = await import('../../app/config.js');
      const configData = await loadConfig();

      expect(typeof configData.review.maxDaysBack).toBe('number');
      expect(typeof configData.review.minCoveragePercent).toBe('number');
    });
  });

  describe('validateConfig', () => {
    it('should validate required configuration fields', async () => {
      process.env.CLAUDE_API_KEY = 'sk-ant-test';
      process.env.GITLAB_TOKEN = 'test-token';

      const { loadConfig, validateConfig } = await import('../../app/config.js');
      const configData = await loadConfig();

      expect(() => validateConfig(configData)).not.toThrow();
    });

    it('should throw error for missing Claude API key', async () => {
      delete process.env.CLAUDE_API_KEY;

      const { loadConfig, validateConfig } = await import('../../app/config.js');
      const configData = await loadConfig();

      expect(() => validateConfig(configData)).toThrow('Claude API key is required');
    });

    it('should throw error if no platform is enabled', async () => {
      const { validateConfig } = await import('../../app/config.js');
      const configData = {
        claude: { apiKey: 'test' },
        platforms: {
          gitlab: { enabled: false },
          github: { enabled: false },
          bitbucket: { enabled: false }
        }
      };

      expect(() => validateConfig(configData)).toThrow('At least one platform must be enabled');
    });
  });
});