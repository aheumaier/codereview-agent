/**
 * Date utility functions for PR filtering
 */

/**
 * Calculate cutoff date for PR filtering based on days back
 * @param {number} daysBack - Number of days to look back from today
 * @returns {Date} The cutoff date
 * @example
 * const cutoff = getPRCutoffDate(7); // 7 days ago from now
 * const today = getPRCutoffDate(0); // today
 * const yesterday = getPRCutoffDate(1); // yesterday
 */
export function getPRCutoffDate(daysBack) {
  const date = new Date();
  date.setDate(date.getDate() - daysBack);
  return date;
}