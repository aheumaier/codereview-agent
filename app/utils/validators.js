/**
 * Input validation utilities
 * Following SOLID principles and Clean Code practices
 * No external dependencies - simple, focused validators
 */

/**
 * Checks if value is a non-empty string
 * @param {any} value - Value to check
 * @returns {boolean} True if non-empty string
 */
export function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validates URL format (HTTP/HTTPS only)
 * @param {any} value - Value to validate
 * @returns {boolean} True if valid HTTP/HTTPS URL
 */
export function isValidUrl(value) {
  if (typeof value !== 'string' || !value) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Checks if value is a positive number (greater than 0)
 * @param {any} value - Value to check
 * @returns {boolean} True if positive number
 */
export function isPositiveNumber(value) {
  return typeof value === 'number' &&
         !isNaN(value) &&
         isFinite(value) &&
         value > 0;
}

/**
 * Checks if value is a positive integer
 * @param {any} value - Value to check
 * @returns {boolean} True if positive integer
 */
export function isPositiveInteger(value) {
  return isPositiveNumber(value) && Number.isInteger(value);
}

/**
 * Checks if value is in allowed enum values
 * @param {any} value - Value to check
 * @param {string[]} allowedValues - Array of allowed values
 * @returns {boolean} True if value in allowed set
 */
export function isValidEnum(value, allowedValues) {
  return typeof value === 'string' &&
         Array.isArray(allowedValues) &&
         allowedValues.includes(value);
}

/**
 * Checks if value is a valid date
 * @param {any} value - Value to check
 * @returns {boolean} True if valid date
 */
export function isValidDate(value) {
  if (!value) return false;

  let date;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === 'string') {
    date = new Date(value);
  } else {
    return false;
  }

  return !isNaN(date.getTime());
}

/**
 * Validates GitLab project/group ID format
 * @param {any} projectId - Project ID to validate
 * @returns {boolean} True if valid project ID
 */
export function validateProjectId(projectId) {
  if (!isNonEmptyString(projectId)) {
    return false;
  }

  // Check for invalid patterns
  if (projectId.startsWith('/') ||
      projectId.endsWith('/') ||
      projectId.includes('//') ||
      projectId.includes(' ')) {
    return false;
  }

  // Valid formats:
  // - Group: "my-group" or "123" (no slash)
  // - Project: "group/project" or "group/subgroup/project" (has slash)
  // - URL-encoded: "group%2Fproject" (encoded slash)

  // Must be alphanumeric, hyphen, underscore, slash, or percent-encoding
  const validPattern = /^[a-zA-Z0-9\-_\/%.]+$/;
  return validPattern.test(projectId);
}

/**
 * Checks if number is within specified range (inclusive)
 * @param {any} value - Value to check
 * @param {number} min - Minimum value (inclusive)
 * @param {number} max - Maximum value (inclusive)
 * @returns {boolean} True if number in range
 */
export function isNumberInRange(value, min, max) {
  return typeof value === 'number' &&
         !isNaN(value) &&
         isFinite(value) &&
         value >= min &&
         value <= max;
}

/**
 * Checks if value is a valid array
 * @param {any} value - Value to check
 * @param {Function} [itemValidator] - Optional validator for array items
 * @returns {boolean} True if valid array
 */
export function isValidArray(value, itemValidator = null) {
  if (!Array.isArray(value)) {
    return false;
  }

  if (itemValidator && typeof itemValidator === 'function') {
    return value.every(item => itemValidator(item));
  }

  return true;
}