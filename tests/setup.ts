import { beforeEach, afterEach } from 'vitest';
import { UsageTracker } from '../src/lib/usage-tracker.js';

// 在每个测试前后自动重置单例
beforeEach(() => {
  UsageTracker.resetInstance();
});

afterEach(() => {
  UsageTracker.resetInstance();
});
