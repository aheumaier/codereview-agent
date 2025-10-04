import FeatureFlags from '../../app/utils/featureFlags.js';

describe('FeatureFlags - Rollout', () => {
  describe('Rollout Percentage', () => {
    it('should enable for all PRs when rollout is 100%', () => {
      const flags = new FeatureFlags({}, { newFeature: 100 });

      expect(flags.isEnabledForPR('newFeature', 'PR-1')).toBe(true);
      expect(flags.isEnabledForPR('newFeature', 'PR-2')).toBe(true);
      expect(flags.isEnabledForPR('newFeature', 'PR-999')).toBe(true);
    });

    it('should disable for all PRs when rollout is 0%', () => {
      const flags = new FeatureFlags({}, { newFeature: 0 });

      expect(flags.isEnabledForPR('newFeature', 'PR-1')).toBe(false);
      expect(flags.isEnabledForPR('newFeature', 'PR-2')).toBe(false);
      expect(flags.isEnabledForPR('newFeature', 'PR-999')).toBe(false);
    });

    it('should be deterministic (same PR always gets same result)', () => {
      const flags = new FeatureFlags({}, { newFeature: 50 });

      const result1 = flags.isEnabledForPR('newFeature', 'PR-123');
      const result2 = flags.isEnabledForPR('newFeature', 'PR-123');
      const result3 = flags.isEnabledForPR('newFeature', 'PR-123');

      expect(result1).toBe(result2);
      expect(result2).toBe(result3);
    });

    it('should distribute PRs approximately according to percentage', () => {
      const flags = new FeatureFlags({}, { newFeature: 30 });

      let enabled = 0;
      const total = 1000;

      for (let i = 0; i < total; i++) {
        if (flags.isEnabledForPR('newFeature', `PR-${i}`)) {
          enabled++;
        }
      }

      const actualPercentage = (enabled / total) * 100;
      // Should be approximately 30% (±5% tolerance)
      expect(actualPercentage).toBeGreaterThan(25);
      expect(actualPercentage).toBeLessThan(35);
    });

    it('should use regular isEnabled when no rollout config', () => {
      const flags = new FeatureFlags({
        regularFeature: true
      }, {});

      expect(flags.isEnabledForPR('regularFeature', 'PR-123')).toBe(true);
    });

    it('should handle fromConfig with rollout section', () => {
      const config = {
        features: {
          oldFeature: true
        },
        rollout: {
          newFeature: 50
        }
      };

      const flags = FeatureFlags.fromConfig(config);

      expect(flags.isEnabled('oldFeature')).toBe(true);
      // newFeature depends on PR ID
      expect(typeof flags.isEnabledForPR('newFeature', 'PR-1')).toBe('boolean');
    });

    it('should handle edge case percentages', () => {
      const flags = new FeatureFlags({}, {
        feature1: -10,  // Should treat as 0
        feature2: 150,  // Should treat as 100
        feature3: 50.5  // Should work with decimals
      });

      // Negative percentage should always return false
      expect(flags.isEnabledForPR('feature1', 'PR-1')).toBe(false);

      // Over 100% should always return true
      expect(flags.isEnabledForPR('feature2', 'PR-1')).toBe(true);

      // Decimal percentage should work
      expect(typeof flags.isEnabledForPR('feature3', 'PR-1')).toBe('boolean');
    });

    it('should handle missing PR ID gracefully', () => {
      const flags = new FeatureFlags({}, { newFeature: 50 });

      // Should handle undefined/null PR ID
      expect(typeof flags.isEnabledForPR('newFeature', undefined)).toBe('boolean');
      expect(typeof flags.isEnabledForPR('newFeature', null)).toBe('boolean');
      expect(typeof flags.isEnabledForPR('newFeature', '')).toBe('boolean');
    });
  });

  describe('Hash Distribution', () => {
    it('should have good hash distribution', () => {
      const flags = new FeatureFlags({}, {});

      // Test hash distribution across different string patterns
      const hashes = new Set();
      for (let i = 0; i < 100; i++) {
        hashes.add(flags._hashCode(`PR-${i}`) % 100);
      }

      // Should produce at least 80 different hash values (good distribution)
      expect(hashes.size).toBeGreaterThan(80);
    });

    it('should produce consistent hashes for same input', () => {
      const flags = new FeatureFlags({}, {});

      const hash1 = flags._hashCode('PR-123');
      const hash2 = flags._hashCode('PR-123');

      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different inputs', () => {
      const flags = new FeatureFlags({}, {});

      const hash1 = flags._hashCode('PR-123');
      const hash2 = flags._hashCode('PR-124');

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Backward Compatibility', () => {
    it('should maintain backward compatibility with existing methods', () => {
      const flags = new FeatureFlags({
        feature1: true,
        feature2: false
      });

      // Existing methods should still work
      expect(flags.isEnabled('feature1')).toBe(true);
      expect(flags.isEnabled('feature2')).toBe(false);
      expect(flags.getAllFlags()).toEqual({ feature1: true, feature2: false });
      expect(flags.checkMultiple(['feature1', 'feature2'])).toEqual({
        feature1: true,
        feature2: false
      });
    });

    it('should work with require method', () => {
      const flags = new FeatureFlags({
        enabledFeature: true
      });

      expect(() => flags.require('enabledFeature')).not.toThrow();
      expect(() => flags.require('disabledFeature')).toThrow();
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle mixed configuration (both features and rollout)', () => {
      const flags = new FeatureFlags(
        { staticFeature: true },
        { dynamicFeature: 75 }
      );

      // Static feature should always be enabled
      expect(flags.isEnabled('staticFeature')).toBe(true);
      expect(flags.isEnabledForPR('staticFeature', 'PR-1')).toBe(true);

      // Dynamic feature depends on rollout
      expect(flags.isEnabled('dynamicFeature')).toBe(false); // Not in regular config

      // Should be enabled for ~75% of PRs
      let enabled = 0;
      for (let i = 0; i < 100; i++) {
        if (flags.isEnabledForPR('dynamicFeature', `PR-${i}`)) {
          enabled++;
        }
      }
      expect(enabled).toBeGreaterThan(65);
      expect(enabled).toBeLessThan(85);
    });

    it('should prioritize rollout config when both exist', () => {
      const flags = new FeatureFlags(
        { feature1: true },  // Static: enabled
        { feature1: 0 }      // Rollout: 0%
      );

      // Regular check uses static config
      expect(flags.isEnabled('feature1')).toBe(true);

      // PR-specific check uses rollout config
      expect(flags.isEnabledForPR('feature1', 'PR-1')).toBe(false);
    });
  });
});