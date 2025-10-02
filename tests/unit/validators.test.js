/**
 * Unit tests for validation utilities
 * Test-driven development for comprehensive input validation
 */

import {
  isNonEmptyString,
  isValidUrl,
  isPositiveNumber,
  isValidEnum,
  isValidDate,
  validateProjectId,
  isNumberInRange,
  isValidArray,
  isPositiveInteger
} from '../../app/utils/validators.js';

describe('Validation Utilities', () => {
  describe('isNonEmptyString', () => {
    test('should return true for non-empty strings', () => {
      expect(isNonEmptyString('hello')).toBe(true);
      expect(isNonEmptyString('  world  ')).toBe(true);
      expect(isNonEmptyString('123')).toBe(true);
      expect(isNonEmptyString('a')).toBe(true);
    });

    test('should return false for empty strings', () => {
      expect(isNonEmptyString('')).toBe(false);
      expect(isNonEmptyString('   ')).toBe(false);
      expect(isNonEmptyString('\t')).toBe(false);
      expect(isNonEmptyString('\n')).toBe(false);
    });

    test('should return false for non-string values', () => {
      expect(isNonEmptyString(null)).toBe(false);
      expect(isNonEmptyString(undefined)).toBe(false);
      expect(isNonEmptyString(123)).toBe(false);
      expect(isNonEmptyString([])).toBe(false);
      expect(isNonEmptyString({})).toBe(false);
      expect(isNonEmptyString(false)).toBe(false);
    });
  });

  describe('isValidUrl', () => {
    test('should return true for valid URLs', () => {
      expect(isValidUrl('https://gitlab.com')).toBe(true);
      expect(isValidUrl('http://localhost:3000')).toBe(true);
      expect(isValidUrl('https://api.github.com/v3')).toBe(true);
      expect(isValidUrl('http://192.168.1.1:8080/api')).toBe(true);
      expect(isValidUrl('https://example.com/path?query=value')).toBe(true);
    });

    test('should return false for invalid URLs', () => {
      expect(isValidUrl('not-a-url')).toBe(false);
      expect(isValidUrl('htp://missing-t')).toBe(false);
      expect(isValidUrl('//no-protocol.com')).toBe(false);
      expect(isValidUrl('ftp://file-server.com')).toBe(false); // Not HTTP/HTTPS
      expect(isValidUrl('')).toBe(false);
    });

    test('should return false for non-string values', () => {
      expect(isValidUrl(null)).toBe(false);
      expect(isValidUrl(undefined)).toBe(false);
      expect(isValidUrl(123)).toBe(false);
      expect(isValidUrl({})).toBe(false);
    });
  });

  describe('isPositiveNumber', () => {
    test('should return true for positive numbers', () => {
      expect(isPositiveNumber(1)).toBe(true);
      expect(isPositiveNumber(0.5)).toBe(true);
      expect(isPositiveNumber(100)).toBe(true);
      expect(isPositiveNumber(999999)).toBe(true);
      expect(isPositiveNumber(0.001)).toBe(true);
    });

    test('should return false for zero and negative numbers', () => {
      expect(isPositiveNumber(0)).toBe(false);
      expect(isPositiveNumber(-1)).toBe(false);
      expect(isPositiveNumber(-0.5)).toBe(false);
      expect(isPositiveNumber(-999)).toBe(false);
    });

    test('should return false for non-numeric values', () => {
      expect(isPositiveNumber('5')).toBe(false);
      expect(isPositiveNumber(null)).toBe(false);
      expect(isPositiveNumber(undefined)).toBe(false);
      expect(isPositiveNumber(NaN)).toBe(false);
      expect(isPositiveNumber(Infinity)).toBe(false);
      expect(isPositiveNumber([])).toBe(false);
    });
  });

  describe('isPositiveInteger', () => {
    test('should return true for positive integers', () => {
      expect(isPositiveInteger(1)).toBe(true);
      expect(isPositiveInteger(10)).toBe(true);
      expect(isPositiveInteger(999)).toBe(true);
    });

    test('should return false for non-integers', () => {
      expect(isPositiveInteger(1.5)).toBe(false);
      expect(isPositiveInteger(0.99)).toBe(false);
      expect(isPositiveInteger(0)).toBe(false);
      expect(isPositiveInteger(-1)).toBe(false);
    });

    test('should return false for non-numeric values', () => {
      expect(isPositiveInteger('5')).toBe(false);
      expect(isPositiveInteger(null)).toBe(false);
      expect(isPositiveInteger(undefined)).toBe(false);
    });
  });

  describe('isValidEnum', () => {
    const allowedValues = ['open', 'closed', 'merged'];

    test('should return true for values in allowed set', () => {
      expect(isValidEnum('open', allowedValues)).toBe(true);
      expect(isValidEnum('closed', allowedValues)).toBe(true);
      expect(isValidEnum('merged', allowedValues)).toBe(true);
    });

    test('should return false for values not in allowed set', () => {
      expect(isValidEnum('pending', allowedValues)).toBe(false);
      expect(isValidEnum('OPEN', allowedValues)).toBe(false);
      expect(isValidEnum('', allowedValues)).toBe(false);
    });

    test('should return false for non-string values', () => {
      expect(isValidEnum(null, allowedValues)).toBe(false);
      expect(isValidEnum(undefined, allowedValues)).toBe(false);
      expect(isValidEnum(123, allowedValues)).toBe(false);
    });

    test('should handle empty allowed values array', () => {
      expect(isValidEnum('any', [])).toBe(false);
    });
  });

  describe('isValidDate', () => {
    test('should return true for valid date strings', () => {
      expect(isValidDate('2024-01-15')).toBe(true);
      expect(isValidDate('2024-01-15T10:30:00Z')).toBe(true);
      expect(isValidDate('2024-12-31T23:59:59.999Z')).toBe(true);
      expect(isValidDate(new Date().toISOString())).toBe(true);
    });

    test('should return true for valid Date objects', () => {
      expect(isValidDate(new Date())).toBe(true);
      expect(isValidDate(new Date('2024-01-15'))).toBe(true);
    });

    test('should return false for invalid date strings', () => {
      expect(isValidDate('not-a-date')).toBe(false);
      expect(isValidDate('2024-13-01')).toBe(false); // Invalid month
      // Note: JavaScript Date constructor is lenient with dates like 2024-02-30,
      // converting them to valid dates (2024-03-01 in this case)
      expect(isValidDate('invalid-date-format')).toBe(false);
      expect(isValidDate('')).toBe(false);
    });

    test('should return false for non-date values', () => {
      expect(isValidDate(null)).toBe(false);
      expect(isValidDate(undefined)).toBe(false);
      expect(isValidDate(123456789)).toBe(false);
      expect(isValidDate({})).toBe(false);
    });
  });

  describe('validateProjectId', () => {
    test('should return true for valid group IDs', () => {
      expect(validateProjectId('my-group')).toBe(true);
      expect(validateProjectId('group123')).toBe(true);
      expect(validateProjectId('123')).toBe(true);
    });

    test('should return true for valid project paths', () => {
      expect(validateProjectId('group/project')).toBe(true);
      expect(validateProjectId('my-group/my-project')).toBe(true);
      expect(validateProjectId('group/subgroup/project')).toBe(true);
    });

    test('should return true for URL-encoded paths', () => {
      expect(validateProjectId('group%2Fproject')).toBe(true);
      expect(validateProjectId('my-group%2Fmy-project')).toBe(true);
    });

    test('should return false for empty or invalid IDs', () => {
      expect(validateProjectId('')).toBe(false);
      expect(validateProjectId('   ')).toBe(false);
      expect(validateProjectId(null)).toBe(false);
      expect(validateProjectId(undefined)).toBe(false);
    });

    test('should return false for IDs with invalid characters', () => {
      expect(validateProjectId('group//project')).toBe(false); // Double slash
      expect(validateProjectId('/project')).toBe(false); // Leading slash
      expect(validateProjectId('group/')).toBe(false); // Trailing slash
      expect(validateProjectId('group project')).toBe(false); // Space without encoding
    });
  });

  describe('isNumberInRange', () => {
    test('should return true for numbers within range', () => {
      expect(isNumberInRange(50, 0, 100)).toBe(true);
      expect(isNumberInRange(0, 0, 100)).toBe(true);
      expect(isNumberInRange(100, 0, 100)).toBe(true);
      expect(isNumberInRange(75.5, 0, 100)).toBe(true);
    });

    test('should return false for numbers outside range', () => {
      expect(isNumberInRange(-1, 0, 100)).toBe(false);
      expect(isNumberInRange(101, 0, 100)).toBe(false);
      expect(isNumberInRange(200, 0, 100)).toBe(false);
    });

    test('should return false for non-numeric values', () => {
      expect(isNumberInRange('50', 0, 100)).toBe(false);
      expect(isNumberInRange(null, 0, 100)).toBe(false);
      expect(isNumberInRange(undefined, 0, 100)).toBe(false);
      expect(isNumberInRange(NaN, 0, 100)).toBe(false);
    });
  });

  describe('isValidArray', () => {
    test('should return true for arrays', () => {
      expect(isValidArray([])).toBe(true);
      expect(isValidArray([1, 2, 3])).toBe(true);
      expect(isValidArray(['a', 'b', 'c'])).toBe(true);
      expect(isValidArray([null, undefined])).toBe(true);
    });

    test('should return false for non-arrays', () => {
      expect(isValidArray(null)).toBe(false);
      expect(isValidArray(undefined)).toBe(false);
      expect(isValidArray('array')).toBe(false);
      expect(isValidArray({})).toBe(false);
      expect(isValidArray(123)).toBe(false);
    });

    test('should validate array element types when validator provided', () => {
      const stringValidator = (item) => typeof item === 'string';

      expect(isValidArray(['a', 'b'], stringValidator)).toBe(true);
      expect(isValidArray(['a', 1], stringValidator)).toBe(false);
      expect(isValidArray([], stringValidator)).toBe(true);
    });
  });
});