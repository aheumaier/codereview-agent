import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { getPRCutoffDate } from '../../app/utils/dateHelpers.js';

describe('getPRCutoffDate', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should return date 7 days in the past', () => {
    const mockNow = new Date('2025-01-15T10:00:00Z');
    jest.setSystemTime(mockNow);

    const cutoffDate = getPRCutoffDate(7);
    const expectedDate = new Date('2025-01-08T10:00:00Z');

    expect(cutoffDate.toISOString()).toBe(expectedDate.toISOString());
  });

  it('should handle 0 days back (today)', () => {
    const mockNow = new Date('2025-01-15T10:00:00Z');
    jest.setSystemTime(mockNow);

    const cutoffDate = getPRCutoffDate(0);

    expect(cutoffDate.toISOString()).toBe(mockNow.toISOString());
  });

  it('should handle 1 day back (yesterday)', () => {
    const mockNow = new Date('2025-01-15T10:00:00Z');
    jest.setSystemTime(mockNow);

    const cutoffDate = getPRCutoffDate(1);
    const expectedDate = new Date('2025-01-14T10:00:00Z');

    expect(cutoffDate.toISOString()).toBe(expectedDate.toISOString());
  });

  it('should handle large numbers (365 days)', () => {
    const mockNow = new Date('2025-01-15T10:00:00Z');
    jest.setSystemTime(mockNow);

    const cutoffDate = getPRCutoffDate(365);
    // 365 days back from 2025-01-15 is 2024-01-16 (2024 is a leap year)
    const expectedDate = new Date('2024-01-16T10:00:00Z');

    expect(cutoffDate.toISOString()).toBe(expectedDate.toISOString());
  });

  it('should handle month boundaries correctly', () => {
    const mockNow = new Date('2025-02-03T10:00:00Z');
    jest.setSystemTime(mockNow);

    const cutoffDate = getPRCutoffDate(5);
    const expectedDate = new Date('2025-01-29T10:00:00Z');

    expect(cutoffDate.toISOString()).toBe(expectedDate.toISOString());
  });

  it('should handle year boundaries correctly', () => {
    const mockNow = new Date('2025-01-03T10:00:00Z');
    jest.setSystemTime(mockNow);

    const cutoffDate = getPRCutoffDate(5);
    const expectedDate = new Date('2024-12-29T10:00:00Z');

    expect(cutoffDate.toISOString()).toBe(expectedDate.toISOString());
  });

  it('should return a Date object with all Date properties', () => {
    const cutoffDate = getPRCutoffDate(7);

    expect(cutoffDate).toBeInstanceOf(Date);
    expect(typeof cutoffDate.getTime).toBe('function');
    expect(typeof cutoffDate.getFullYear).toBe('function');
    expect(typeof cutoffDate.getMonth).toBe('function');
    expect(typeof cutoffDate.getDate).toBe('function');
  });

  it('should preserve time of day when calculating days back', () => {
    const mockNow = new Date('2025-01-15T15:30:45.123Z');
    jest.setSystemTime(mockNow);

    const cutoffDate = getPRCutoffDate(3);
    const expectedDate = new Date('2025-01-12T15:30:45.123Z');

    // Verify the date changed but time remained the same
    expect(cutoffDate.toISOString()).toBe(expectedDate.toISOString());
  });

  it('should handle decimal days (rounds to nearest integer)', () => {
    const mockNow = new Date('2025-01-15T10:00:00Z');
    jest.setSystemTime(mockNow);

    const cutoffDate = getPRCutoffDate(7.8);

    // JavaScript's setDate() with decimals appears to round to nearest integer
    // 7.8 rounds to 8, so we expect 8 days back
    const expectedDate = new Date('2025-01-07T10:00:00Z');

    expect(cutoffDate.toISOString()).toBe(expectedDate.toISOString());
  });

  it('should handle negative numbers by moving forward in time', () => {
    const mockNow = new Date('2025-01-15T10:00:00Z');
    jest.setSystemTime(mockNow);

    const cutoffDate = getPRCutoffDate(-3);
    const expectedDate = new Date('2025-01-18T10:00:00Z');

    expect(cutoffDate.toISOString()).toBe(expectedDate.toISOString());
  });
});