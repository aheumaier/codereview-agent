import FeatureFlags from '../../app/utils/featureFlags.js';

describe('FeatureFlags', () => {
  let featureFlags;

  describe('with default config', () => {
    beforeEach(() => {
      featureFlags = new FeatureFlags({
        useStateManagement: false,
        useSubAgents: false,
        useDecisionMatrix: false,
        legacyMode: true
      });
    });

    it('should correctly report enabled features', () => {
      expect(featureFlags.isEnabled('legacyMode')).toBe(true);
      expect(featureFlags.isEnabled('useStateManagement')).toBe(false);
      expect(featureFlags.isEnabled('useSubAgents')).toBe(false);
      expect(featureFlags.isEnabled('useDecisionMatrix')).toBe(false);
    });

    it('should return false for unknown features', () => {
      expect(featureFlags.isEnabled('unknownFeature')).toBe(false);
      expect(featureFlags.isEnabled('randomFlag')).toBe(false);
    });

    it('should throw error when requiring disabled feature', () => {
      expect(() => featureFlags.require('useStateManagement'))
        .toThrow('Feature "useStateManagement" is not enabled');
    });

    it('should not throw when requiring enabled feature', () => {
      expect(() => featureFlags.require('legacyMode')).not.toThrow();
    });
  });

  describe('with custom config', () => {
    beforeEach(() => {
      featureFlags = new FeatureFlags({
        useStateManagement: true,
        useSubAgents: true,
        customFeature: 'enabled',
        numericFeature: 1,
        objectFeature: { enabled: true }
      });
    });

    it('should handle truthy values as enabled', () => {
      expect(featureFlags.isEnabled('useStateManagement')).toBe(true);
      expect(featureFlags.isEnabled('useSubAgents')).toBe(true);
      expect(featureFlags.isEnabled('customFeature')).toBe(true);
      expect(featureFlags.isEnabled('numericFeature')).toBe(true);
      expect(featureFlags.isEnabled('objectFeature')).toBe(true);
    });

    it('should handle falsy values as disabled', () => {
      const flags = new FeatureFlags({
        emptyString: '',
        zero: 0,
        nullValue: null,
        undefinedValue: undefined,
        falseValue: false
      });

      expect(flags.isEnabled('emptyString')).toBe(false);
      expect(flags.isEnabled('zero')).toBe(false);
      expect(flags.isEnabled('nullValue')).toBe(false);
      expect(flags.isEnabled('undefinedValue')).toBe(false);
      expect(flags.isEnabled('falseValue')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle empty config', () => {
      const flags = new FeatureFlags({});
      expect(flags.isEnabled('anyFeature')).toBe(false);
      expect(() => flags.require('anyFeature')).toThrow();
    });

    it('should handle null config', () => {
      const flags = new FeatureFlags(null);
      expect(flags.isEnabled('anyFeature')).toBe(false);
    });

    it('should handle undefined config', () => {
      const flags = new FeatureFlags(undefined);
      expect(flags.isEnabled('anyFeature')).toBe(false);
    });

    it('should be case-sensitive', () => {
      const flags = new FeatureFlags({
        myFeature: true,
        MyFeature: false
      });

      expect(flags.isEnabled('myFeature')).toBe(true);
      expect(flags.isEnabled('MyFeature')).toBe(false);
      expect(flags.isEnabled('MYFEATURE')).toBe(false);
    });
  });

  describe('require method', () => {
    beforeEach(() => {
      featureFlags = new FeatureFlags({
        enabledFeature: true,
        disabledFeature: false
      });
    });

    it('should return true for enabled features', () => {
      const result = featureFlags.require('enabledFeature');
      expect(result).toBe(true);
    });

    it('should throw with descriptive message for disabled features', () => {
      expect(() => featureFlags.require('disabledFeature'))
        .toThrow('Feature "disabledFeature" is not enabled');
    });

    it('should throw for unknown features', () => {
      expect(() => featureFlags.require('unknownFeature'))
        .toThrow('Feature "unknownFeature" is not enabled');
    });

    it('should handle null/undefined feature names', () => {
      expect(() => featureFlags.require(null))
        .toThrow('Feature "null" is not enabled');
      expect(() => featureFlags.require(undefined))
        .toThrow('Feature "undefined" is not enabled');
    });
  });

  describe('getAllFlags method', () => {
    it('should return all configured flags', () => {
      const config = {
        flag1: true,
        flag2: false,
        flag3: 'enabled'
      };
      const flags = new FeatureFlags(config);

      const allFlags = flags.getAllFlags();
      expect(allFlags).toEqual(config);
    });

    it('should return empty object for no config', () => {
      const flags = new FeatureFlags();
      expect(flags.getAllFlags()).toEqual({});
    });

    it('should return a copy, not reference', () => {
      const config = { flag1: true };
      const flags = new FeatureFlags(config);

      const allFlags = flags.getAllFlags();
      allFlags.flag1 = false;

      expect(flags.isEnabled('flag1')).toBe(true);
    });
  });
});