import { describe, it, expect } from 'vitest';
import { StatsPage } from '../../../src/admin/views/stats.js';

const baseStats = {
  totalRequests: 12,
  successfulRequests: 10,
  failedRequests: 2,
  byModel: {},
  byProvider: {},
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalTokens: 0,
  totalCachedTokens: 0,
} as any;

function sampleRow(overrides: Partial<any> = {}) {
  return {
    id: 1, requestId: 'r1', timestamp: '2026-08-29T02:00:00.000Z',
    userName: 'alice', customModel: 'gpt-4', modelGroup: null,
    realModel: 'gpt-4', provider: 'openai', statusCode: 200,
    durationMs: 5000, promptTokens: 100, completionTokens: 50,
    totalTokens: 150, cachedTokens: 0, isStreaming: 1,
    ttftMs: 250, tps: 42.5, errorMessage: null,
    ...overrides,
  };
}

// 注：style 块内含全部 .avg-pill* 类名，故断言用 DOM 属性形态 `class="avg-pill avg-pill--xxx"`
const DOM_TTFT_PILL = 'class="avg-pill avg-pill--ttft"';
const DOM_TPS_PILL = 'class="avg-pill avg-pill--tps"';
const DOM_EMPTY_PILL = 'class="avg-pill avg-pill--empty"';

describe('StatsPage — AVG TTFT / TPS header pill', () => {
  it('renders both pills when averages are provided', () => {
    const html = String(
      <StatsPage
        stats={baseStats}
        dateRange="2026-08-29 ~ 2026-08-29"
        currentType="date"
        currentValue="2026-08-29"
        recentRequests={[sampleRow()]}
        page={1}
        totalPages={1}
        totalItems={12}
        startDate="2026-08-29"
        endDate="2026-08-29"
        timezone="UTC"
        avgTtftMs={250}
        avgTps={42.5}
      />,
    );
    expect(html).toContain('请求列表 (共 12 条)');
    expect(html).toContain(DOM_TTFT_PILL);
    expect(html).toContain(DOM_TPS_PILL);
    expect(html).toContain('平均 TTFT');
    expect(html).toContain('平均 TPS');
    expect(html).toContain('250ms');
    expect(html).toContain('42.5 tok/s');
  });

  it('renders empty pill when no streaming averages but list has rows', () => {
    const html = String(
      <StatsPage
        stats={baseStats}
        dateRange="2026-08-29 ~ 2026-08-29"
        currentType="date"
        currentValue="2026-08-29"
        recentRequests={[sampleRow({ isStreaming: 0, ttftMs: null, tps: null })]}
        totalItems={1}
        startDate="2026-08-29"
        endDate="2026-08-29"
        timezone="UTC"
        avgTtftMs={null}
        avgTps={null}
      />,
    );
    expect(html).toContain(DOM_EMPTY_PILL);
    expect(html).toContain('仅流式请求可计算');
    expect(html).not.toContain(DOM_TTFT_PILL);
    expect(html).not.toContain(DOM_TPS_PILL);
  });

  it('renders only TTFT pill when TPS is null', () => {
    const html = String(
      <StatsPage
        stats={baseStats}
        dateRange="2026-08-29 ~ 2026-08-29"
        currentType="date"
        currentValue="2026-08-29"
        recentRequests={[sampleRow({ tps: null })]}
        totalItems={1}
        startDate="2026-08-29"
        endDate="2026-08-29"
        timezone="UTC"
        avgTtftMs={200}
        avgTps={null}
      />,
    );
    expect(html).toContain(DOM_TTFT_PILL);
    expect(html).not.toContain(DOM_TPS_PILL);
    expect(html).toContain('200ms');
  });
});

describe('StatsPage — 模型组列', () => {
  function renderList(rows: any[]) {
    return String(
      <StatsPage
        stats={baseStats}
        dateRange="2026-08-29 ~ 2026-08-29"
        currentType="date"
        currentValue="2026-08-29"
        recentRequests={rows}
        totalItems={rows.length}
        startDate="2026-08-29"
        endDate="2026-08-29"
        timezone="UTC"
      />,
    );
  }

  it('表头包含模型组列', () => {
    const html = renderList([sampleRow()]);
    expect(html).toContain('<th>模型组</th>');
  });

  it('有模型组的行显示组名', () => {
    const html = renderList([sampleRow({ customModel: 'deepseek-v4', modelGroup: 'local-kkshen-use' })]);
    expect(html).toContain('title="local-kkshen-use"');
    expect(html).toContain('>local-kkshen-use</td>');
  });

  it('无模型组的行显示占位符', () => {
    const html = renderList([sampleRow({ customModel: 'glm-5.2', modelGroup: null })]);
    expect(html).toContain('title="glm-5.2"');
    expect(html).toContain('>—</td>');
  });
});

