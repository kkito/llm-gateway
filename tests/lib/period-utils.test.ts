import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getTodayDate,
  getWeekStart,
  getMonthStart,
  getPeriodRange,
  getPeriodDescription
} from '../../src/lib/period-utils.js';

describe('period-utils', () => {
  describe('getTodayDate', () => {
    it('should return correct date in YYYY-MM-DD format', () => {
      const date = getTodayDate();
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should return today date', () => {
      const date = getTodayDate();
      const today = new Date().toISOString().split('T')[0];
      expect(date).toBe(today);
    });
  });

  describe('getWeekStart', () => {
    it('should return Monday of current week', () => {
      const weekStart = getWeekStart();
      expect(weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      
      // 验证返回的是周一
      const date = new Date(weekStart);
      const day = date.getDay() || 7;
      expect(day).toBe(1);
    });

    it('should return consistent result within same week', () => {
      const first = getWeekStart();
      const second = getWeekStart();
      expect(first).toBe(second);
    });
  });

  describe('getMonthStart', () => {
    it('should return first day of current month', () => {
      const monthStart = getMonthStart();
      expect(monthStart).toMatch(/^\d{4}-\d{2}-01$/);
      
      const now = new Date();
      const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      expect(monthStart).toBe(expected);
    });
  });

  describe('getPeriodRange', () => {
    it('should return day range', () => {
      const range = getPeriodRange('day');
      expect(range.start).toBe(getTodayDate());
      expect(range.end).toBe(getTodayDate());
      expect(range.description).toBe('daily');
    });

    it('should return week range', () => {
      const range = getPeriodRange('week');
      expect(range.start).toBe(getWeekStart());
      expect(range.end).toBe(getTodayDate());
      expect(range.description).toBe('weekly');
    });

    it('should return month range', () => {
      const range = getPeriodRange('month');
      expect(range.start).toBe(getMonthStart());
      expect(range.end).toBe(getTodayDate());
      expect(range.description).toBe('monthly');
    });

    it('should return hours range with custom value', () => {
      const range = getPeriodRange('hours', 5);
      expect(range.description).toBe('last 5 hours');
      
      // 验证开始时间是 5 小时前
      const now = new Date();
      const past = new Date(now.getTime() - 5 * 3600 * 1000);
      expect(range.start).toBe(past.toISOString().split('T')[0]);
    });

    it('should use default 24 hours when periodValue not provided', () => {
      const range = getPeriodRange('hours');
      expect(range.description).toBe('last 24 hours');
    });
  });

  describe('getPeriodDescription', () => {
    it('should return correct description for each period', () => {
      expect(getPeriodDescription('day')).toBe('daily');
      expect(getPeriodDescription('week')).toBe('weekly');
      expect(getPeriodDescription('month')).toBe('monthly');
      expect(getPeriodDescription('hours', 5)).toBe('last 5 hours');
    });
  });
});
