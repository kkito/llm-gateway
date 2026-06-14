/**
 * @vitest-environment jsdom
 *
 * 验证 StatsView 渲染出的 HTML 包含可执行的客户端 JS。
 */

import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { StatsView } from '@/user/views/stats.js';
import type { StatsViewProps } from '@/user/views/stats.js';

const mockProps: StatsViewProps = {
  overview: {
    totalRequests: 5,
    totalTokens: 1140,
    totalInputTokens: 800,
    totalOutputTokens: 340,
    avgDuration: 1600,
  },
  byModel: [
    { model: 'gpt-4', requests: 3, successful: 2, failed: 1, inputTokens: 350, outputTokens: 130, totalTokens: 480, avgDuration: 1333 },
    { model: 'claude-3', requests: 2, successful: 2, failed: 0, inputTokens: 450, outputTokens: 210, totalTokens: 660, avgDuration: 2000 },
  ],
  byHour: [
    { hour: '2026-06-14 02:00', requests: 2, successful: 2, failed: 0, inputTokens: 300, outputTokens: 130, totalTokens: 430 },
    { hour: '2026-06-14 03:00', requests: 2, successful: 1, failed: 1, inputTokens: 350, outputTokens: 150, totalTokens: 500 },
    { hour: '2026-06-14 04:00', requests: 1, successful: 1, failed: 0, inputTokens: 150, outputTokens: 60, totalTokens: 210 },
  ],
  recentRequests: [
    { id: 5, requestId: 'req-5', timestamp: '2026-06-14T04:00:00.000Z', userName: 'test-user', customModel: 'claude-3', modelGroup: null, realModel: 'claude-3-opus', provider: 'anthropic', statusCode: 200, durationMs: 1000, promptTokens: 150, completionTokens: 60, totalTokens: 210, cachedTokens: 0, isStreaming: 1, errorMessage: null },
    { id: 4, requestId: 'req-4', timestamp: '2026-06-14T03:30:00.000Z', userName: 'test-user', customModel: 'gpt-4', modelGroup: 'openai-group', realModel: 'gpt-4-0613', provider: 'openai', statusCode: 400, durationMs: 500, promptTokens: 50, completionTokens: 0, totalTokens: 50, cachedTokens: 20, isStreaming: 0, errorMessage: 'Rate limit exceeded' },
  ],
  userName: 'test-user',
  startDate: '2026-06-14',
  endDate: '2026-06-14',
  page: 1,
  totalPages: 1,
  tzOffset: -480, // UTC+8
  selectedModel: '',
};

function renderHtml(): string {
  // Hono JSX 组件可以通过 toString() 渲染为 HTML
  return StatsView(mockProps).toString();
}

describe('StatsView client JS - UTC time conversion', () => {
  it('<td data-utc> 属性值应为原始 UTC ISO', () => {
    const html = renderHtml();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    const cells = doc.querySelectorAll('[data-utc]');
    expect(cells.length).toBeGreaterThanOrEqual(2);
    expect(cells[0].getAttribute('data-utc')).toBe('2026-06-14T04:00:00.000Z');
  });

  it('应该包含 <script> 标签', () => {
    const html = renderHtml();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    const scripts = doc.querySelectorAll('script');
    expect(scripts.length).toBeGreaterThanOrEqual(1);
  });

  it('script 内容应包含 [data-utc] 查询且未被转义', () => {
    const html = renderHtml();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    const script = doc.querySelector('script');
    expect(script).not.toBeNull();
    const content = script!.textContent || '';

    // 关键检查
    expect(content).toContain('[data-utc]');
    expect(content).toContain('querySelectorAll');
    expect(content).toContain('el.textContent');
    // 不应被 HTML 实体转义
    expect(content).not.toContain('&lt;');
  });

  it('script 内容应包含 toLocaleString 或手动的本地时间转换逻辑', () => {
    const html = renderHtml();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    const script = doc.querySelector('script');
    const content = script!.textContent || '';

    // 应包含时间转换的关键操作
    expect(content).toContain('getFullYear');
    expect(content).toContain('padStart');
    expect(content).toContain('getHours');
    expect(content).toContain('getMinutes');
  });
});

describe('StatsView client JS - hour distribution', () => {
  it('<div class="hour-item"> 应有 data-hour-utc 属性', () => {
    const html = renderHtml();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    const items = doc.querySelectorAll('[data-hour-utc]');
    expect(items.length).toBe(3);
    expect(items[0].getAttribute('data-hour-utc')).toBe('2026-06-14T02:00:00.000Z');
    expect(items[0].getAttribute('data-requests')).toBe('2');
    expect(items[0].getAttribute('data-tokens')).toBe('430');
  });
});

describe('StatsView - 表格列', () => {
  it('表头应包含 输入Token 和 输出Token', () => {
    const html = renderHtml();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    const headerText = doc.querySelector('table thead tr')?.textContent || '';
    expect(headerText).toContain('输入Token(缓存/总输入)');
    expect(headerText).toContain('输出Token');
    // 不再有单独的 Token 列
    expect(headerText).not.toContain('>Token<');
  });

  it('输入Token 列应显示缓存+总输入格式', () => {
    const html = renderHtml();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    const rows = doc.querySelectorAll('table tbody tr');
    // 列顺序：时间=0, 用户=1, 模型=2, 模型组=3, 状态码=4, 耗时=5, 输入Token=6, 输出Token=7
    // 第一行：prompt=150, cache=0 → "150"（cache=0 只显示总输入）
    // 第二行：prompt=50, cache=20 → "20/50 (40%)"
    const firstRowCells = rows[0]?.querySelectorAll('td');
    expect(firstRowCells).toBeDefined();
    if (firstRowCells) {
      expect(firstRowCells[6].textContent).toBe('150');
      expect(firstRowCells[7].textContent).toBe('60');
    }
    const secondRowCells = rows[1]?.querySelectorAll('td');
    if (secondRowCells) {
      expect(secondRowCells[6].textContent).toBe('20/50 (40.00%)');
      expect(secondRowCells[7].textContent).toBe('0');
    }
  });
});

describe('StatsView - 执行客户端 JS 后的行为', () => {
  it('执行 script 后 UTC 时间戳应转为本地时间', () => {
    const html = renderHtml();
    const dom = new JSDOM(html, { runScripts: 'dangerously' });
    const doc = dom.window.document;

    // 执行内联 script
    const scripts = doc.querySelectorAll('script');
    scripts.forEach((script) => {
      const fn = new dom.window.Function(script.textContent || '');
      fn();
    });

    // 验证 UTC 时间已转为本地时间（UTC+8 时，04:00 UTC = 12:00 本地）
    const cells = doc.querySelectorAll('[data-utc]');
    expect(cells.length).toBeGreaterThanOrEqual(2);
    // 第一个 data-utc 的文本应为本地时间格式（不含年份）
    expect(cells[0].textContent).toBe('06-14 12:00:00');
  });
});
