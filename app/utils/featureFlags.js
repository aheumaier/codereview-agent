/**
 * FeatureFlags - Simple feature flag management
 *
 * This class provides a centralized way to manage feature flags,
 * allowing gradual rollout of new functionality.
 */
class FeatureFlags {
  constructor(config = {}, rolloutConfig = {}) {
    // Store config, handling null/undefined
    this.config = config || {};
    // Store rollout configuration for percentage-based feature enablement
    this.rolloutConfig = rolloutConfig || {};
  }

  /**
   * Check if a feature is enabled
   * @param {string} flagName - Name of the feature flag
   * @returns {boolean} True if enabled, false otherwise
   */
  isEnabled(flagName) {
    // Return false for unknown flags
    if (!(flagName in this.config)) {
      return false;
    }

    // Convert to boolean - any truthy value is enabled
    return Boolean(this.config[flagName]);
  }

  /**
   * Require a feature to be enabled, throw if not
   * @param {string} flagName - Name of the feature flag
   * @returns {boolean} True if enabled
   * @throws {Error} If feature is not enabled
   */
  require(flagName) {
    if (!this.isEnabled(flagName)) {
      throw new Error(`Feature "${flagName}" is not enabled`);
    }
    return true;
  }

  /**
   * Get all configured flags
   * @returns {Object} Copy of all feature flags
   */
  getAllFlags() {
    // Return a copy to prevent external modification
    return { ...this.config };
  }

  /**
   * Check multiple flags at once
   * @param {string[]} flagNames - Array of flag names
   * @returns {Object} Object with flag names as keys and enabled status as values
   */
  checkMultiple(flagNames) {
    const results = {};
    for (const flag of flagNames) {
      results[flag] = this.isEnabled(flag);
    }
    return results;
  }

  /**
   * Check if feature is enabled for specific PR using rollout percentage
   * @param {string} flagName - Feature flag name
   * @param {string} prId - PR identifier for rollout
   * @returns {boolean} True if enabled for this PR
   */
  isEnabledForPR(flagName, prId) {
    // If flag not in rollout config, use regular isEnabled
    if (!(flagName in this.rolloutConfig)) {
      return this.isEnabled(flagName);
    }

    const percentage = this.rolloutConfig[flagName];

    // Handle edge cases
    if (percentage <= 0) return false;
    if (percentage >= 100) return true;

    // Hash-based selection for gradual rollout
    return this._shouldEnableForId(prId || '', percentage);
  }

  /**
   * Deterministic hash-based selection
   * @private
   * @param {string} id - Identifier to hash
   * @param {number} percentage - Rollout percentage
   * @returns {boolean} True if should be enabled
   */
  _shouldEnableForId(id, percentage) {
    const hash = this._hashCode(String(id));
    return (hash % 100) < percentage;
  }

  /**
   * Simple string hash function for deterministic selection
   * @private
   * @param {string} str - String to hash
   * @returns {number} Positive integer hash value
   */
  _hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Create a new FeatureFlags instance from config file
   * @param {Object} fullConfig - Full configuration object
   * @returns {FeatureFlags} New instance with features and rollout sections
   */
  static fromConfig(fullConfig) {
    const features = fullConfig?.features || {};
    const rollout = fullConfig?.rollout || {};
    return new FeatureFlags(features, rollout);
  }
}

export default FeatureFlags;