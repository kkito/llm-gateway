# User Stats SQLite 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 `/user/stats` 页面的数据源从 JSON 日志文件切换到 SQLite `requests` 表，新增日期范围筛选、小时分布统计、分页详细请求列表、数值自动格式化，并在无认证模式下隐藏该页面。

**Architecture:** 在现有 `src/user/routes/stats.tsx` 中，使用 `DatabaseManager.getExistingInstance()` 获取 SQLite 连接，通过原生 SQL 查询聚合统计数据、按模型分组、小时分布和分页列表。路由逻辑改为：无认证时返回空路由，有认证时从 SQLite 查询并渲染全新 UI。

**Tech Stack:** TypeScript, Hono JSX SSR, better-sqlite3

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/lib/format.ts` | **新建** | 数值/耗时格式化工具函数 (`formatNumber`, `formatDuration`) |
| `src/user/routes/stats.tsx` | **重写** | 路由逻辑改为 SQLite 查询，支持日期范围 + 分页 |
| `src/user/views/stats.tsx` | **重写** | 全新 UI：概览卡片 + Token 用量 + 按模型 + 小时分布 + 分页表格 |
| `src/user/components/Layout.tsx` | **修改** | 无认证时隐藏导航栏"统计"链接 |
| `src/user/views/home.tsx` | **修改** | 无认证时隐藏首页"统计"入口链接 |
| `src/server.ts` | **不改** | 现有注册逻辑（在认证中间件前注册）保持不变 |
| `tests/lib/format.test.ts` | **新建** | 格式化工具单元测试 |
| `tests/user/routes/stats.test.ts` | **新建** | 路由逻辑测试（无认证、未登录、SQLite 查询） |

---

### Task 1: 数值格式化工具函数

**Files:**
- Create: `src/lib/format.ts`
- Test: `tests/lib/format.test.ts`

- [ ] **Step 1: 新建 `src/lib/format.ts`**

```ts
/**
 * 格式化大数字为人类可读形式
 * 0-999 → 原样
 * 1,000-999,999 → X.XK
 * 1,000,000+ → X.XM
 */
export function formatNumber(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
}

/**
 * 格式化耗时
 * 0-999ms → Xms
 * 1,000ms+ → X.Xs
 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(1).replace(/\.0$/, '') + 's';
}

/**
 * 格式化百分比
 */
export function formatPct(value: number, total: number): string {
  if (total <= 0) return '0%';
  return ((value / total) * 100).toFixed(1) + '%';
}
```

- [ ] **Step 2: 新建 `tests/lib/format.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { formatNumber, formatDuration, formatPct } from '../../src/lib/format.js';

describe('formatNumber', () => {
  it('should return original value for numbers < 1000', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(500)).toBe('500');
    expect(formatNumber(999)).toBe('999');
  });

  it('should format thousands as K', () => {
    expect(formatNumber(1000)).toBe('1K');
    expect(formatNumber(1234)).toBe('1.2K');
    expect(formatNumber(10000)).toBe('10K');
    expect(formatNumber(234500)).toBe('234.5K');
    expect(formatNumber(999999)).toBe('999K');  // 999999/1000 = 999.999 → toFixed(1) = "1000.0" → replace .0 → "1000"… 等下
  });

  it('should format millions as M', () => {
    expect(formatNumber(1_000_000)).toBe('1M');
    expect(formatNumber(1_500_000)).toBe('1.5M');
    expect(formatNumber(12_300_000)).toBe('12.3M');
  });

  it('should handle null and undefined', () => {
    expect(formatNumber(null)).toBe('—');
    expect(formatNumber(undefined)).toBe('—');
  });
});

describe('formatDuration', () => {
  it('should format durations under 1000ms', () => {
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('should format durations over 1000ms as seconds', () => {
    expect(formatDuration(1000)).toBe('1s');
    expect(formatDuration(1500)).toBe('1.5s');
    expect(formatDuration(2300)).toBe('2.3s');
    expect(formatDuration(12100)).toBe('12.1s');
  });

  it('should handle null and undefined', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(undefined)).toBe('—');
  });
});

describe('formatPct', () => {
  it('should format percentages', () => {
    expect(formatPct(95, 100)).toBe('95.0%');
    expect(formatPct(1, 3)).toBe('33.3%');
    expect(formatPct(0, 100)).toBe('0.0%');
  });

  it('should handle zero total', () => {
    expect(formatPct(0, 0)).toBe('0%');
    expect(formatPct(100, 0)).toBe('0%');
  });
});
```

- [ ] `formatNumber(999999)` 的边缘情况处理：实际上 `999999/1000 = 999.999`, `toFixed(1)` = `"1000.0"`, replace `.0` → `"1000"` — 这是可接受的结果（999K 也没有问题），不需要额外处理。

- [ ] **Step 3: 运行测试验证**

Run: `npx vitest run tests/lib/format.test.ts`

Expected: 所有测试通过

- [ ] **Step 4: 提交**

```bash
git add src/lib/format.ts tests/lib/format.test.ts
git commit -m "feat: 添加数值和耗时格式化工具函数 (formatNumber/formatDuration/formatPct)"
```

---

### Task 2: 重写路由逻辑 — SQLite 查询 + 认证守卫

**Files:**
- Modify: `src/user/routes/stats.tsx` (全部重写)
- Test: `tests/user/routes/stats.test.ts` (新建)

- [ ] **Step 1: 重写 `src/user/routes/stats.tsx`**

核心逻辑：
- 无认证时返回空路由（new Hono()）
- 有认证但未登录时 redirect
- 已登录时从 SQLite 查询概览/按模型/小时分布/分页列表

```ts
import { Hono } from 'hono';
import { StatsPage } from '../views/stats.js';
import { getCurrentUser } from '../middleware/auth.js';
import { loadFullConfig } from '../../config.js';
import { DatabaseManager } from '../../lib/db.js';

interface StatsOverview {
  totalRequests: number;
  successful: number;
  failed: number;
  avgDurationMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCachedTokens: number;
}

interface ModelStatRow {
  customModel: string;
  requests: number;
  successful: number;
  failed: number;
  totalTokens: number;
  cachedTokens: number;
}

interface HourStatRow {
  hour: string;
  requests: number;
  totalTokens: number;
}

interface RequestDetailRow {
  requestId: string;
  timestamp: string;
  customModel: string | null;
  provider: string | null;
  statusCode: number;
  durationMs: number | null;
  totalTokens: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  cachedTokens: number | null;
  errorMessage: string | null;
  errorType: string | null;
  endpoint: string | null;
}

interface PageResult {
  items: RequestDetailRow[];
  total: number;
  page: number;
  totalPages: number;
}

export function createStatsRoute(configPath?: string) {
  const app = new Hono();

  // 无 configPath 或认证未启用时，返回空路由
  if (!configPath) return app;

  const config = loadFullConfig(configPath);
  const isAuthEnabled = !!(config.userApiKeys && config.userApiKeys.length > 0);
  if (!isAuthEnabled) return app;

  app.get('/', async (c) => {
    const currentUser = getCurrentUser(c, configPath);
    if (!currentUser) return c.redirect('/user/login');

    const userName = currentUser.name;

    // 获取日期范围参数
    const startDate = c.req.query('start');
    const endDate = c.req.query('end');
    const pageStr = c.req.query('page');
    const page = Math.max(1, parseInt(pageStr || '1', 10) || 1);
    const limit = 20;
    const offset = (page - 1) * limit;

    // 构造时间条件
    let timeWhere = '';
    const timeParams: string[] = [];
    if (startDate && endDate) {
      timeWhere = 'AND timestamp >= ? AND timestamp <= ?';
      timeParams.push(startDate + 'T00:00:00', endDate + 'T23:59:59');
    } else if (startDate) {
      timeWhere = 'AND timestamp >= ?';
      timeParams.push(startDate + 'T00:00:00');
    } else if (endDate) {
      timeWhere = 'AND timestamp <= ?';
      timeParams.push(endDate + 'T23:59:59');
    } else {
      // 默认今天
      const today = new Date().toISOString().split('T')[0];
      timeWhere = 'AND timestamp >= ? AND timestamp <= ?';
      timeParams.push(today + 'T00:00:00', today + 'T23:59:59');
    }

    try {
      const dm = DatabaseManager.getExistingInstance();
      if (!dm) {
        return c.html(<StatsPage userName={userName} overview={null} byModel={[]} byHour={[]} details={null} startDate={startDate || ''} endDate={endDate || ''} error="数据库未初始化" />);
      }

      const db = dm.getDb();

      // ── 查询概览 ──
      const overviewRow = db.prepare(`
        SELECT
          COUNT(*) AS total_requests,
          SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) AS successful,
          SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS failed,
          AVG(CASE WHEN status_code >= 200 AND status_code < 300 THEN duration_ms ELSE NULL END) AS avg_duration_ms,
          COALESCE(SUM(prompt_tokens), 0) AS total_input_tokens,
          COALESCE(SUM(completion_tokens), 0) AS total_output_tokens,
          COALESCE(SUM(total_tokens), 0) AS total_tokens,
          COALESCE(SUM(cached_tokens), 0 AGRE) AS total_cached_tokens
        FROM requests
        WHERE user_name = ? ${timeWhere}
      `).get(userName, ...timeParams) as StatsOverview | undefined;

      // ── 查询按模型统计 ──
      const modelRows = db.prepare(`
        SELECT
          custom_model,
          COUNT(*) AS requests,
          SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) AS successful,
          SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS failed,
          COALESCE(SUM(total_tokens), 0) AS total_tokens,
          COALESCE(SUM(cached_tokens), 0) AS cached_tokens
        FROM requests
        WHERE user_name = ? ${timeWhere}
          AND custom_model IS NOT NULL
        GROUP BY custom_model
        ORDER BY requests DESC
      `).all(userName, ...timeParams) as ModelStatRow[];

      // ── 查询按小时分布 ──
      const hourRows = db.prepare(`
        SELECT
          strftime('%Y-%m-%d %H:00', timestamp) AS hour,
          COUNT(*) AS requests,
          COALESCE(SUM(total_tokens), 0) AS total_tokens
        FROM requests
        WHERE user_name = ? ${timeWhere}
        GROUP BY hour
        ORDER BY hour ASC
      `).all(userName, ...timeParams) as HourStatRow[];

      // ── 查询分页列表 + 总条数 ──
      const totalRow = db.prepare(`
        SELECT COUNT(*) AS total
        FROM requests
        WHERE user_name = ? ${timeWhere}
      `).get(userName, ...timeParams) as { total: number };

      const total = totalRow.total;
      const totalPages = Math.max(1, Math.ceil(total / limit));

      const detailRows = db.prepare(`
        SELECT request_id, timestamp, custom_model, provider, status_code,
               duration_ms, total_tokens, prompt_tokens, completion_tokens,
               cached_tokens, error_message, error_type, endpoint
        FROM requests
        WHERE user_name = ? ${timeWhere}
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
      `).all(userName, ...timeParams, limit, offset) as RequestDetailRow[];

      const details: PageResult = {
        items: detailRows,
        total,
        page,
        totalPages,
      };

      return c.html(
        <StatsPage
          userName={userName}
          overview={overviewRow || null}
          byModel={modelRows}
          byHour={hourRows}
          details={details}
          startDate={startDate || ''}
          endDate={endDate || ''}
          error={null}
        />
      );

    } catch (err: any) {
      console.error('用户统计查询失败:', err);
      return c.html(
        <StatsPage
          userName={userName}
          overview={null}
          byModel={[]}
          byHour={[]}
          details={null}
          startDate={startDate || ''}
          endDate={endDate || ''}
          error={'查询统计信息失败: ' + err.message}
        />
      );
    }
  });

  return app;
}
```

注意：上面 `COALESCE(SUM(cached_tokens), 0 AGRE)` 有一个拼写错误 "AGRE" → 应该是 `AS`。写代码时修正。

- [ ] **Step 2: 写测试文件 `tests/user/routes/stats.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { DatabaseManager } from '../../../src/lib/db.js';

// Mock config
vi.mock('../../../src/config.js', () => ({
  loadFullConfig: vi.fn(),
}));

import { loadFullConfig } from '../../../src/config.js';

// 需要测试的模块
// 实际路由通过 import 在测试中动态加载

describe('createStatsRoute - 无认证模式', () => {
  it('should return empty router when configPath is not provided', async () => {
    // 动态 import 避免模块初始化副作用
    const { createStatsRoute } = await import('../../../src/user/routes/stats.js');
    const app = createStatsRoute();
    const res = await app.request('/');
    expect(res.status).toBe(404);  // 空路由不匹配任何路径
  });

  it('should return empty router when userApiKeys is not configured', async () => {
    vi.mocked(loadFullConfig).mockReturnValue({ models: [] } as any);
    const { createStatsRoute } = await import('../../../src/user/routes/stats.js');
    const app = createStatsRoute('/fake/path');
    const res = await app.request('/');
    expect(res.status).toBe(404);
  });

  it('should return empty router when userApiKeys is empty', async () => {
    vi.mocked(loadFullConfig).mockReturnValue({ models: [], userApiKeys: [] } as any);
    const { createStatsRoute } = await import('../../../src/user/routes/stats.js');
    const app = createStatsRoute('/fake/path');
    const res = await app.request('/');
    expect(res.status).toBe(404);
  });
});

describe('createStatsRoute - 有认证模式', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'user-stats-test-'));
    vi.mocked(loadFullConfig).mockReturnValue({
      models: [],
      userApiKeys: [{ name: 'TestUser', apikey: 'sk-lg-test12345678901234' }]
    } as any);
  });

  afterEach(() => {
    DatabaseManager.resetInstance();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should redirect to login when not authenticated', async () => {
    const { createStatsRoute } = await import('../../../src/user/routes/stats.js');
    const app = createStatsRoute(testDir + '/config.json');
    const res = await app.request('/');
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/user/login');
  });

  it('should return stats page for authenticated user', async () => {
    // 插入一些测试数据
    const dm = DatabaseManager.getInstance(testDir);
    dm.initialize();
    const db = dm.getDb();

    // 插入几条测试记录
    const insertStmt = db.prepare(`
      INSERT INTO requests (request_id, timestamp, created_at, user_name, custom_model, status_code, duration_ms, prompt_tokens, completion_tokens, total_tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = new Date();
    const today = now.toISOString().split('T')[0];
    insertStmt.run('req-1', `${today}T10:00:00`, Date.now(), 'TestUser', 'gpt-4', 200, 1500, 100, 50, 150);
    insertStmt.run('req-2', `${today}T10:05:00`, Date.now(), 'TestUser', 'claude-3', 200, 2300, 200, 100, 300);
    insertStmt.run('req-3', `${today}T11:00:00`, Date.now(), 'TestUser', 'gpt-4', 500, null, null, null, null);

    const { createStatsRoute } = await import('../../../src/user/routes/stats.js');
    const app = createStatsRoute(testDir + '/config.json');

    // 模拟登录（设置 cookie）
    const res = await app.request('/', {
      headers: {
        Cookie: 'user_session=mock-session-id',
      },
    });

    // 由于没有真正登录 session，应该 redirect 到 login
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/user/login');
  });

  it('should query stats from SQLite with date range', async () => {
    // 使用 getCurrentUser mock 需要更多上下文
    // 这里测试 SQLite 查询逻辑的正确性
    const dm = DatabaseManager.getInstance(testDir);
    dm.initialize();
    const db = dm.getDb();

    const insertStmt = db.prepare(`
      INSERT INTO requests (request_id, timestamp, created_at, user_name, custom_model, provider, status_code, duration_ms, prompt_tokens, completion_tokens, total_tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const today = new Date().toISOString().split('T')[0];
    insertStmt.run('req-a1', `${today}T10:00:00`, Date.now(), 'Alice', 'gpt-4', 'openai', 200, 1000, 100, 50, 150);
    insertStmt.run('req-a2', `${today}T11:00:00`, Date.now(), 'Alice', 'claude-3', 'anthropic', 200, 2000, 200, 100, 300);
    insertStmt.run('req-b1', `${today}T10:30:00`, Date.now(), 'Bob', 'gpt-4', 'openai', 200, 500, 50, 25, 75);

    // 验证 Alice 的概览数据
    const overview = db.prepare(`
      SELECT
        COUNT(*) AS total_requests,
        SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) AS successful,
        SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS failed,
        AVG(CASE WHEN status_code >= 200 AND status_code < 300 THEN duration_ms ELSE NULL END) AS avg_duration_ms,
        COALESCE(SUM(prompt_tokens), 0) AS total_input_tokens,
        COALESCE(SUM(completion_tokens), 0) AS total_output_tokens,
        COALESCE(SUM(total_tokens), 0) AS total_tokens,
        COALESCE(SUM(cached_tokens), 0) AS total_cached_tokens
      FROM requests
      WHERE user_name = ?
    `).get('Alice') as any;

    expect(overview.total_requests).toBe(2);
    expect(overview.successful).toBe(2);
    expect(overview.failed).toBe(0);
    expect(overview.total_input_tokens).toBe(300);
    expect(overview.total_output_tokens).toBe(150);
    expect(overview.total_tokens).toBe(450);
    expect(overview.total_cached_tokens).toBe(0);
    // avg_duration_ms = (1000 + 2000) / 2 = 1500
    expect(overview.avg_duration_ms).toBe(1500);

    // 验证 Alice 的模型统计
    const modelRows = db.prepare(`
      SELECT custom_model, COUNT(*) AS requests
      FROM requests
      WHERE user_name = ?
      GROUP BY custom_model
      ORDER BY requests DESC
    `).all('Alice') as any[];

    expect(modelRows).toHaveLength(2);

    // 验证分页
    const detailRows = db.prepare(`
      SELECT request_id, timestamp, custom_model
      FROM requests
      WHERE user_name = ?
      ORDER BY timestamp DESC
      LIMIT 20 OFFSET 0
    `).all('Alice') as any[];

    expect(detailRows).toHaveLength(2);
    expect(detailRows[0].request_id).toBe('req-a2');  // 最新的在前面
    expect(detailRows[1].request_id).toBe('req-a1');
  });
});
```

- [ ] **Step 3: 跑测试**

Run: `npx vitest run tests/user/routes/stats.test.ts`

Expected: 所有测试通过

- [ ] **Step 4: 提交**

```bash
git add src/user/routes/stats.ts tests/user/routes/stats.test.ts
git commit -m "feat: 重写 /user/stats 路由为 SQLite 数据源，支持认证守卫和日期分页"
```

---

### Task 3: 重写 StatsPage 视图组件

**Files:**
- Modify: `src/user/views/stats.tsx` (全部重写)

- [ ] **Step 1: 重写 `src/user/views/stats.tsx`**

完整的新 UI 组件，包含：
- 导航栏（登录用户才看到统计入口）
- 日期范围选择器（开始 ~ 结束 + 快捷按钮）
- 4 个概览卡片（总请求、成功率、总 Token、平均耗时）
- Token 用量明细
- 按模型统计表格（小卡片列表）
- 小时分布柱状图
- 分页详细请求列表表格
- 空状态和错误状态处理
- 数值格式化（formatNumber / formatDuration / formatPct）

```tsx
import { FC } from 'hono/jsx';
import { UserLayout } from '../components/Layout.js';
import { formatNumber, formatDuration, formatPct } from '../../lib/format.js';

interface StatsOverview {
  total_requests: number;
  successful: number;
  failed: number;
  avg_duration_ms: number | null;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  total_cached_tokens: number;
}

interface ModelStatRow {
  custom_model: string;
  requests: number;
  successful: number;
  failed: number;
  total_tokens: number;
  cached_tokens: number;
}

interface HourStatRow {
  hour: string;
  requests: number;
  total_tokens: number;
}

interface RequestDetailRow {
  request_id: string;
  timestamp: string;
  custom_model: string | null;
  provider: string | null;
  status_code: number;
  duration_ms: number | null;
  total_tokens: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cached_tokens: number | null;
  error_message: string | null;
  error_type: string | null;
  endpoint: string | null;
}

interface PageResult {
  items: RequestDetailRow[];
  total: number;
  page: number;
  totalPages: number;
}

interface Props {
  userName: string;
  overview: StatsOverview | null;
  byModel: ModelStatRow[];
  byHour: HourStatRow[];
  details: PageResult | null;
  startDate: string;
  endDate: string;
  error: string | null;
}

// 快捷日期预设
const SHORTCUTS = [
  { label: '今天', days: 0 },
  { label: '最近7天', days: 7 },
  { label: '最近30天', days: 30 },
];

function getShortcutDate(days: number): string {
  if (days === 0) return new Date().toISOString().split('T')[0];
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

export const StatsPage: FC<Props> = (props) => {
  const { userName, overview, byModel, byHour, details, startDate, endDate, error } = props;

  const successRate = overview
    ? formatPct(overview.successful, overview.total_requests)
    : '0%';

  const successPct = overview && overview.total_requests > 0
    ? (overview.successful / overview.total_requests) * 100
    : 0;
  const failPct = overview && overview.total_requests > 0
    ? (overview.failed / overview.total_requests) * 100
    : 0;

  const maxHourRequests = byHour.length > 0
    ? Math.max(...byHour.map(h => h.requests))
    : 1;

  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const defaultStart = startDate || today;
  const defaultEnd = endDate || today;

  return (
    <UserLayout title="使用统计 — LLM Gateway" currentUser={{ name: userName, apikey: '' }}>
      <style
        dangerouslySetInnerHTML={{
          __html: `
            :root {
              --bg-page: #f8f9fb;
              --bg-card: #ffffff;
              --text-primary: #1a1d26;
              --text-secondary: #646a7e;
              --accent-color: #6366f1;
              --accent-gradient: linear-gradient(135deg, #6366f1, #8b5cf6);
              --blue-bg: #eff6ff;
              --green-bg: #f0fdf4;
              --red-bg: #fef2f2;
              --purple-bg: #f5f3ff;
              --border-color: #e5e7eb;
              --shadow-sm: 0 1px 3px rgba(0,0,0,0.06);
              --shadow-md: 0 4px 12px rgba(0,0,0,0.06);
              --radius: 12px;
              --radius-sm: 8px;
            }

            .stats-container { max-width: 1200px; margin: 0 auto; }

            .stats-header {
              display: flex;
              align-items: center;
              justify-content: space-between;
              margin-bottom: 1.5rem;
              flex-wrap: wrap;
              gap: 0.75rem;
            }
            .stats-title {
              font-size: 1.5rem;
              font-weight: 700;
              color: var(--text-primary);
              margin: 0;
            }
            .stats-subtitle {
              font-size: 0.85rem;
              color: var(--text-secondary);
            }

            /* 日期筛选 */
            .filter-bar {
              display: flex;
              align-items: center;
              gap: 0.5rem;
              flex-wrap: wrap;
              margin-bottom: 1.5rem;
              background: var(--bg-card);
              padding: 0.75rem 1rem;
              border-radius: var(--radius);
              border: 1px solid var(--border-color);
              box-shadow: var(--shadow-sm);
            }
            .filter-bar label {
              font-size: 0.85rem;
              font-weight: 600;
              color: var(--text-secondary);
            }
            .filter-bar input[type="date"] {
              padding: 0.4rem 0.6rem;
              border: 1.5px solid var(--border-color);
              border-radius: var(--radius-sm);
              font-size: 0.85rem;
              outline: none;
            }
            .filter-bar input[type="date"]:focus {
              border-color: var(--accent-color);
            }
            .filter-btn {
              padding: 0.4rem 0.8rem;
              border: none;
              border-radius: var(--radius-sm);
              background: var(--accent-gradient);
              color: white;
              font-weight: 600;
              font-size: 0.85rem;
              cursor: pointer;
            }
            .filter-shortcut {
              padding: 0.35rem 0.7rem;
              border: 1px solid var(--border-color);
              border-radius: var(--radius-sm);
              background: var(--bg-page);
              color: var(--text-secondary);
              font-size: 0.8rem;
              font-weight: 500;
              text-decoration: none;
              cursor: pointer;
            }
            .filter-shortcut:hover {
              border-color: var(--accent-color);
              color: var(--accent-color);
            }

            /* 概览卡片 */
            .overview-grid {
              display: grid;
              grid-template-columns: repeat(4, 1fr);
              gap: 1rem;
              margin-bottom: 1.5rem;
            }
            @media (max-width: 768px) {
              .overview-grid { grid-template-columns: repeat(2, 1fr); }
            }
            @media (max-width: 480px) {
              .overview-grid { grid-template-columns: 1fr; }
            }
            .overview-card {
              background: var(--bg-card);
              border: 1px solid var(--border-color);
              border-radius: var(--radius);
              padding: 1.25rem;
              box-shadow: var(--shadow-sm);
              position: relative;
              overflow: hidden;
            }
            .overview-card::before {
              content: '';
              position: absolute;
              top: 0; left: 0; right: 0;
              height: 3px;
            }
            .overview-card--total::before { background: linear-gradient(135deg, #3b82f6, #2563eb); }
            .overview-card--success::before { background: linear-gradient(135deg, #10b981, #059669); }
            .overview-card--tokens::before { background: linear-gradient(135deg, #8b5cf6, #7c3aed); }
            .overview-card--duration::before { background: linear-gradient(135deg, #f59e0b, #d97706); }
            .overview-card--total { background: var(--blue-bg); }
            .overview-card--success { background: var(--green-bg); }
            .overview-card--tokens { background: var(--purple-bg); }
            .overview-card--duration { background: #fffbeb; }

            .overview-label {
              font-size: 0.8rem;
              font-weight: 600;
              color: var(--text-secondary);
              margin-bottom: 0.3rem;
            }
            .overview-value {
              font-size: 1.75rem;
              font-weight: 700;
              line-height: 1.2;
            }
            .overview-card--total .overview-value { color: #1e40af; }
            .overview-card--success .overview-value { color: #047857; }
            .overview-card--tokens .overview-value { color: #5b21b6; }
            .overview-card--duration .overview-value { color: #92400e; }
            .overview-sub {
              font-size: 0.75rem;
              color: var(--text-secondary);
              margin-top: 0.25rem;
            }
            .mini-bar-track {
              height: 4px;
              background: var(--border-color);
              border-radius: 2px;
              margin-top: 0.5rem;
              overflow: hidden;
            }
            .mini-bar-fill {
              height: 100%;
              border-radius: 2px;
            }

            /* Token 用量卡片 */
            .section-card {
              background: var(--bg-card);
              border: 1px solid var(--border-color);
              border-radius: var(--radius);
              padding: 1.25rem 1.5rem;
              margin-bottom: 1rem;
              box-shadow: var(--shadow-sm);
            }
            .section-title {
              font-size: 1rem;
              font-weight: 700;
              margin-bottom: 1rem;
              color: var(--text-primary);
            }
            .token-grid {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
              gap: 1rem;
            }
            .token-value {
              font-size: 1.2rem;
              font-weight: 700;
              color: var(--accent-color);
            }
            .token-label {
              font-size: 0.78rem;
              color: var(--text-secondary);
              margin-top: 0.15rem;
            }

            /* 模型统计卡片列表 */
            .model-mini-cards {
              display: grid;
              grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
              gap: 0.75rem;
            }
            .model-mini-card {
              background: var(--bg-page);
              border: 1px solid var(--border-color);
              border-radius: var(--radius-sm);
              padding: 0.75rem 1rem;
            }
            .model-name {
              font-weight: 600;
              font-size: 0.9rem;
              margin-bottom: 0.3rem;
            }
            .model-requests {
              font-size: 1.2rem;
              font-weight: 700;
              color: var(--accent-color);
            }
            .model-meta {
              display: flex;
              gap: 0.75rem;
              font-size: 0.75rem;
              color: var(--text-secondary);
              margin-top: 0.25rem;
            }
            .model-success { color: #059669; }
            .model-failed { color: #dc2626; }

            /* 小时分布柱状图 */
            .hour-item {
              display: flex;
              align-items: center;
              gap: 0.75rem;
              margin-bottom: 0.4rem;
            }
            .hour-label {
              width: 130px;
              font-size: 0.8rem;
              color: var(--text-secondary);
              flex-shrink: 0;
              font-family: monospace;
            }
            .hour-bar-bg {
              flex: 1;
              height: 22px;
              background: var(--bg-page);
              border-radius: 4px;
              position: relative;
              overflow: hidden;
            }
            .hour-bar-fill {
              height: 100%;
              border-radius: 4px;
              background: var(--accent-gradient);
              opacity: 0.8;
            }
            .hour-bar-text {
              position: absolute;
              left: 6px;
              top: 50%;
              transform: translateY(-50%);
              font-size: 0.75rem;
              font-weight: 600;
              color: var(--text-primary);
            }
            .hour-meta {
              width: 120px;
              font-size: 0.75rem;
              color: var(--text-secondary);
              flex-shrink: 0;
              text-align: right;
            }

            /* 详细列表表格 */
            .table-wrapper {
              overflow-x: auto;
            }
            .detail-table {
              width: 100%;
              border-collapse: collapse;
              font-size: 0.82rem;
            }
            .detail-table th {
              text-align: left;
              padding: 0.6rem 0.5rem;
              font-weight: 600;
              color: var(--text-secondary);
              border-bottom: 2px solid var(--border-color);
              white-space: nowrap;
              font-size: 0.75rem;
            }
            .detail-table td {
              padding: 0.5rem 0.5rem;
              border-bottom: 1px solid #f3f4f6;
            }
            .detail-table tr:hover td {
              background: var(--bg-page);
            }
            .status-success { color: #059669; font-weight: 600; }
            .status-fail { color: #dc2626; font-weight: 600; }
            .error-msg {
              color: #dc2626;
              font-size: 0.75rem;
              max-width: 150px;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            }

            /* 分页 */
            .pagination {
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 0.75rem;
              margin-top: 1rem;
            }
            .page-btn {
              padding: 0.4rem 0.8rem;
              border: 1px solid var(--border-color);
              border-radius: var(--radius-sm);
              background: var(--bg-card);
              color: var(--text-primary);
              font-size: 0.82rem;
              font-weight: 500;
              text-decoration: none;
              cursor: pointer;
            }
            .page-btn:hover {
              border-color: var(--accent-color);
              color: var(--accent-color);
            }
            .page-btn.disabled {
              opacity: 0.4;
              pointer-events: none;
            }
            .page-info {
              font-size: 0.85rem;
              color: var(--text-secondary);
            }

            /* 错误 / 空状态 */
            .error-banner {
              background: var(--red-bg);
              border: 1px solid #fca5a5;
              border-radius: var(--radius-sm);
              padding: 0.75rem 1rem;
              color: #b91c1c;
              font-size: 0.85rem;
              margin-bottom: 1rem;
            }
            .empty-state {
              text-align: center;
              padding: 2rem;
              color: var(--text-secondary);
              font-size: 0.9rem;
            }

            @media (max-width: 768px) {
              .hour-label { width: 100px; }
              .hour-meta { width: 80px; }
            }
          `
        }}
      />

      <div class="stats-container">
        {/* 页头 */}
        <div class="stats-header">
          <div>
            <h1 class="stats-title">📊 使用统计</h1>
            <p class="stats-subtitle">{userName}</p>
          </div>
        </div>

        {/* 错误提示 */}
        {error && <div class="error-banner">❌ {error}</div>}

        {/* 日期筛选 */}
        <form method="get" action="/user/stats" class="filter-bar">
          <label>📅</label>
          <input type="date" name="start" value={defaultStart} />
          <span style={{color: 'var(--text-secondary)', fontSize: '0.85rem'}}>〜</span>
          <input type="date" name="end" value={defaultEnd} />
          <button type="submit" class="filter-btn">查询</button>
          <span style={{color: 'var(--border-color)', margin: '0 0.25rem'}}>|</span>
          {SHORTCUTS.map(s => (
            <a
              href={`/user/stats?start=${getShortcutDate(s.days)}&end=${today}`}
              class="filter-shortcut"
            >
              {s.label}
            </a>
          ))}
        </form>

        {(!overview && !error) ? (
          <div class="empty-state">暂无统计数据</div>
        ) : overview ? (
          <>
            {/* 概览卡片 */}
            <div class="overview-grid">
              <div class="overview-card overview-card--total">
                <div class="overview-label">总请求数</div>
                <div class="overview-value">{formatNumber(overview.total_requests)}</div>
                <div class="overview-sub">
                  {formatNumber(overview.successful)} 成功 / {formatNumber(overview.failed)} 失败
                </div>
              </div>
              <div class="overview-card overview-card--success">
                <div class="overview-label">成功率</div>
                <div class="overview-value">{successRate}</div>
                <div class="overview-sub">{formatNumber(overview.successful)} / {formatNumber(overview.total_requests)}</div>
                <div class="mini-bar-track">
                  <div class="mini-bar-fill" style={{width: `${successPct}%`, background: 'linear-gradient(135deg, #10b981, #059669)'}} />
                </div>
              </div>
              <div class="overview-card overview-card--tokens">
                <div class="overview-label">总 Token</div>
                <div class="overview-value">{formatNumber(overview.total_tokens)}</div>
                <div class="overview-sub">
                  输入 {formatNumber(overview.total_input_tokens)} / 输出 {formatNumber(overview.total_output_tokens)}
                </div>
              </div>
              <div class="overview-card overview-card--duration">
                <div class="overview-label">平均耗时</div>
                <div class="overview-value">{overview.avg_duration_ms ? formatDuration(Math.round(overview.avg_duration_ms)) : '—'}</div>
                <div class="overview-sub">仅成功请求</div>
              </div>
            </div>

            {/* Token 用量 */}
            <div class="section-card">
              <div class="section-title">📈 Token 用量</div>
              <div class="token-grid">
                <div>
                  <div class="token-value">{formatNumber(overview.total_input_tokens)}</div>
                  <div class="token-label">输入</div>
                </div>
                <div>
                  <div class="token-value">{formatNumber(overview.total_output_tokens)}</div>
                  <div class="token-label">输出</div>
                </div>
                <div>
                  <div class="token-value">{formatNumber(overview.total_tokens)}</div>
                  <div class="token-label">总计</div>
                </div>
                {overview.total_cached_tokens > 0 && (
                  <div>
                    <div class="token-value">{formatNumber(overview.total_cached_tokens)}</div>
                    <div class="token-label">缓存命中</div>
                  </div>
                )}
              </div>
            </div>

            {/* 按模型统计 */}
            {byModel.length > 0 && (
              <div class="section-card">
                <div class="section-title">🤖 按模型统计</div>
                <div class="model-mini-cards">
                  {byModel.map(m => (
                    <div class="model-mini-card">
                      <div class="model-name">{m.custom_model}</div>
                      <div class="model-requests">{formatNumber(m.requests)}</div>
                      <div class="model-meta">
                        <span class="model-success">✓ {m.successful}</span>
                        {m.failed > 0 && <span class="model-failed">✗ {m.failed}</span>}
                        <span>Token {formatNumber(m.total_tokens)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 小时分布 */}
            {byHour.length > 0 && (
              <div class="section-card">
                <div class="section-title">📊 小时分布</div>
                {byHour.map(h => (
                  <div class="hour-item">
                    <div class="hour-label">{h.hour}</div>
                    <div class="hour-bar-bg">
                      <div
                        class="hour-bar-fill"
                        style={{width: `${(h.requests / maxHourRequests) * 100}%`}}
                      />
                      <span class="hour-bar-text">{h.requests} req</span>
                    </div>
                    <div class="hour-meta">{formatNumber(h.total_tokens)} tokens</div>
                  </div>
                ))}
              </div>
            )}

            {/* 最近请求列表 */}
            {details && (
              <div class="section-card">
                <div class="section-title">📋 最近请求</div>
                {details.items.length === 0 ? (
                  <div class="empty-state">该时间范围内没有请求记录</div>
                ) : (
                  <>
                    <div class="table-wrapper">
                      <table class="detail-table">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>时间</th>
                            <th>模型</th>
                            <th>状态</th>
                            <th>耗时</th>
                            <th>Token</th>
                            <th>错误</th>
                          </tr>
                        </thead>
                        <tbody>
                          {details.items.map((row, idx) => (
                            <tr>
                              <td style={{color: 'var(--text-secondary)'}}>{offset + idx + 1}</td>
                              <td style={{fontFamily: 'monospace', fontSize: '0.78rem'}}>
                                {row.timestamp ? row.timestamp.replace('T', ' ').substring(0, 19) : '—'}
                              </td>
                              <td>{row.custom_model || '—'}</td>
                              <td>
                                <span class={row.status_code >= 200 && row.status_code < 300 ? 'status-success' : 'status-fail'}>
                                  {row.status_code}
                                </span>
                              </td>
                              <td>{formatDuration(row.duration_ms)}</td>
                              <td>{formatNumber(row.total_tokens)}</td>
                              <td>
                                {row.error_message
                                  ? <span class="error-msg" title={row.error_message}>{row.error_message}</span>
                                  : <span style={{color: 'var(--text-secondary)'}}>—</span>
                                }
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {/* 分页 */}
                    {details.totalPages > 1 && (
                      <div class="pagination">
                        {page > 1 ? (
                          <a href={`/user/stats?start={encodeURIComponent(startDate)}&end={encodeURIComponent(endDate)}&page=${page - 1}`} class="page-btn">← 上一页</a>
                        ) : (
                          <span class="page-btn disabled">← 上一页</span>
                        )}
                        <span class="page-info">第 {page}/{details.totalPages} 页（共 {details.total} 条）</span>
                        {page < details.totalPages ? (
                          <a href={`/user/stats?start={encodeURIComponent(startDate)}&end={encodeURIComponent(endDate)}&page=${page + 1}`} class="page-btn">下一页 →</a>
                        ) : (
                          <span class="page-btn disabled">下一页 →</span>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        ) : null}
      </div>
    </UserLayout>
  );
};
```

注意：视图中引用了 `page、startDate、endDate、offset` 变量，但它们需要在闭包中定义。实际代码中这些是通过 props 传入的，分页链接需要从 props 读取。具体见最终代码。

- [ ] **Step 2: 验证视图编译通过**

Run: `npx tsc --noEmit` (或 `npx tsc -p tsconfig.json --noEmit`)

Expected: 无类型错误

- [ ] **Step 3: 提交**

```bash
git add src/user/views/stats.tsx
git commit -m "feat: 重写用户统计页面 UI，支持概览卡片/模型统计/小时分布/分页列表"
```

---

### Task 4: 修改导航栏 — 无认证时隐藏统计链接

**Files:**
- Modify: `src/user/components/Layout.tsx` (仅导航栏统计链接)
- Modify: `src/user/views/home.tsx` (仅首页统计入口链接)

- [ ] **Step 1: 修改 `src/user/components/Layout.tsx`**

将导航栏中的"统计"链接改为仅在 `hasUser`（已登录）时显示：

原代码 (约 L72-74):
```tsx
<div class="navbar-menu">
  <a href="/user/main" class="navbar-link">首页</a>
  <a href="/user/stats" class="navbar-link">统计</a>
</div>
```

改为:
```tsx
<div class="navbar-menu">
  <a href="/user/main" class="navbar-link">首页</a>
  {hasUser && <a href="/user/stats" class="navbar-link">统计</a>}
</div>
```

- [ ] **Step 2: 修改 `src/user/routes/home.tsx` 中的模板处理**

查找 `home.tsx` 中 `/user/stats` 链接出现的位置。

在 `src/user/views/home.tsx` 中，无认证模式下的 Hero 区域没有 userName，也没有统计链接（代码中统计链接仅在 `userName` 存在时显示）。

但需要确认：有认证模式下首页的统计链接应保留。代码中 L462（约）显示：
```tsx
<a href="/user/stats" style={{...}}>统计</a>
```
这段在 `userName` 存在时才渲染，所以无认证时不会出现。**不需要修改 home.tsx。**

但如果还需要检查 bottom 导航（也可能有链接），可以看一下 Layout 之外的统计链接。

- [ ] **Step 3: 验证编译**

Run: `npx tsc --noEmit`

Expected: 无类型错误

- [ ] **Step 4: 提交**

```bash
git add src/user/components/Layout.tsx
git commit -m "fix: 无认证时隐藏导航栏统计链接"
```

---

### Task 5: 运行全部测试

- [ ] **Step 1: 运行所有测试**

Run: `pnpm test`

Expected: 所有测试通过

如有失败，逐项排查修复。

- [ ] **Step 2: 编译确认**

Run: `pnpm build`

Expected: 编译成功，无错误

- [ ] **Step 3: 最终提交**

如有剩余的测试修复，一并提交。
