import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { ConfigurationError, createConfigError } from './utils/errorHelpers.js';
import {
  isNonEmptyString,
  isValidUrl,
  isPositiveNumber,
  isPositiveInteger,
  isValidEnum,
  isNumberInRange,
  isValidArray,
  validateProjectId
} from './utils/validators.js';

// Load environment variables - override any existing shell variables
const result = dotenv.config({ override: true });

if (result.error) {
  console.warn('Warning: Error loading .env file:', result.error.message);
} else {
  console.log('✓ .env file loaded successfully');
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Expands environment variables in a value
 * @param {any} value - Value to process
 * @returns {any} Processed value with expanded environment variables
 */
function expandEnvVars(value) {
  if (typeof value === 'string') {
    // Replace ${VAR_NAME} with environment variable value
    const expanded = value.replace(/\$\{([^}]+)\}/g, (match, varName) => {
      return process.env[varName] || '';
    });

    // Convert string booleans to actual booleans
    if (expanded === 'true') return true;
    if (expanded === 'false') return false;

    return expanded;
  }

  if (Array.isArray(value)) {
    return value.map(expandEnvVars);
  }

  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = expandEnvVars(val);
    }
    return result;
  }

  return value;
}

/**
 * Loads configuration from config.json and expands environment variables
 * @returns {Promise<Object>} Configuration object
 */
export async function loadConfig() {
  const configPath = path.join(__dirname, '..', 'conf', 'config.json');
  const configContent = await fs.readFile(configPath, 'utf-8');
  const config = JSON.parse(configContent);

  // Recursively expand environment variables
  return expandEnvVars(config);
}

/**
 * Validates the configuration object
 * @param {Object} config - Configuration object to validate
 * @throws {ConfigurationError} If configuration is invalid
 */
export function validateConfig(config) {
  // Check for Claude API key
  if (!isNonEmptyString(config.claude?.apiKey)) {
    throw createConfigError('claude.apiKey', 'Must be a non-empty string');
  }

  // Check that at least one platform is enabled
  const enabledPlatforms = Object.values(config.platforms || {})
    .filter(platform => platform.enabled);

  if (enabledPlatforms.length === 0) {
    throw new ConfigurationError('At least one platform must be enabled', 'platforms');
  }

  // Validate enabled platforms have required credentials and URLs
  for (const [name, platform] of Object.entries(config.platforms || {})) {
    if (platform.enabled) {
      // Validate platform URLs
      if (platform.url && !isValidUrl(platform.url)) {
        throw createConfigError(`platforms.${name}.url`, 'Must be a valid URL');
      }

      // Validate platform-specific credentials
      if (name === 'gitlab') {
        if (!isNonEmptyString(platform.token)) {
          throw createConfigError('platforms.gitlab.token', 'Must be a non-empty string when GitLab is enabled');
        }
        if (platform.projectId && !validateProjectId(platform.projectId)) {
          throw createConfigError('platforms.gitlab.projectId', 'Must be a valid GitLab project or group ID');
        }
      }

      if (name === 'github') {
        if (!isNonEmptyString(platform.token)) {
          throw createConfigError('platforms.github.token', 'Must be a non-empty string when GitHub is enabled');
        }
      }

      if (name === 'bitbucket') {
        if (!isNonEmptyString(platform.username)) {
          throw createConfigError('platforms.bitbucket.username', 'Must be a non-empty string when Bitbucket is enabled');
        }
        if (!isNonEmptyString(platform.appPassword)) {
          throw createConfigError('platforms.bitbucket.appPassword', 'Must be a non-empty string when Bitbucket is enabled');
        }
      }
    }
  }

  // Validate review configuration numeric values
  if (config.review) {
    if (config.review.maxDaysBack !== undefined && !isPositiveNumber(config.review.maxDaysBack)) {
      throw createConfigError('review.maxDaysBack', 'Must be a positive number');
    }

    if (config.review.maxFilesPerPR !== undefined && !isPositiveNumber(config.review.maxFilesPerPR)) {
      throw createConfigError('review.maxFilesPerPR', 'Must be a positive number');
    }

    if (config.review.maxLinesPerFile !== undefined && !isPositiveNumber(config.review.maxLinesPerFile)) {
      throw createConfigError('review.maxLinesPerFile', 'Must be a positive number');
    }

    if (config.review.maxComplexity !== undefined && !isPositiveNumber(config.review.maxComplexity)) {
      throw createConfigError('review.maxComplexity', 'Must be a positive number');
    }

    if (config.review.minCoveragePercent !== undefined && !isNumberInRange(config.review.minCoveragePercent, 0, 100)) {
      throw createConfigError('review.minCoveragePercent', 'Must be a number between 0 and 100');
    }

    // Validate arrays
    if (config.review.prStates !== undefined) {
      if (!isValidArray(config.review.prStates)) {
        throw createConfigError('review.prStates', 'Must be an array');
      }

      // Validate enum values
      const validStates = ['open', 'closed', 'merged'];
      for (const state of config.review.prStates) {
        if (!isValidEnum(state, validStates)) {
          throw createConfigError('review.prStates', `Invalid state '${state}'. Must be one of: ${validStates.join(', ')}`);
        }
      }
    }

    if (config.review.excludeLabels !== undefined && !isValidArray(config.review.excludeLabels, isNonEmptyString)) {
      throw createConfigError('review.excludeLabels', 'Must be an array of strings');
    }
  }

  // Validate tracking configuration
  if (config.tracking) {
    if (config.tracking.ttlDays !== undefined && !isPositiveInteger(config.tracking.ttlDays)) {
      throw createConfigError('tracking.ttlDays', 'Must be a positive integer');
    }

    if (!isNonEmptyString(config.tracking.dbPath)) {
      throw createConfigError('tracking.dbPath', 'Must be a non-empty string');
    }
  }

  // Validate output configuration
  if (config.output) {
    if (config.output.dryRun !== undefined && typeof config.output.dryRun !== 'boolean') {
      throw createConfigError('output.dryRun', 'Must be a boolean value');
    }
  }
}