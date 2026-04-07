import { beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { UsageTracker } from '../src/lib/usage-tracker.js';

// 保存原始的 console 方法
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

// 在所有测试前静默 console
beforeAll(() => {
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
});

// 所有测试后恢复
afterAll(() => {
  console.log = originalLog;
  console.warn = originalWarn;
  console.error = originalError;
});

beforeEach(() => {
  UsageTracker.resetInstance();
});

afterEach(() => {
  UsageTracker.resetInstance();
});
