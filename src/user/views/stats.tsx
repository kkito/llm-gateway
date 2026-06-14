import type { FC } from 'hono/jsx';
import { UserLayout } from '../components/Layout.js';
import { formatNumber, formatDuration } from '../../lib/format.js';

// ---- Props 接口定义 ----

export interface OverviewStats {
  totalRequests: number;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  avgDuration: number;
}

export interface ModelStatsEntry {
  model: string;
  requests: number;
  successful: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  avgDuration: number;
}

export interface HourStatsEntry {
  hour: string;
  requests: number;
  successful: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface RecentRequestEntry {
  id: number;
  requestId: string;
  timestamp: string;
  userName: string | null;
  customModel: string;
  modelGroup: string | null;
  realModel: string | null;
  provider: string | null;
  statusCode: number;
  durationMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  cachedTokens: number | null;
  isStreaming: number | null;
  errorMessage: string | null;
}

export interface StatsViewProps {
  overview: OverviewStats;
  byModel: ModelStatsEntry[];
  byHour: HourStatsEntry[];
  recentRequests: RecentRequestEntry[];
  userName: string;
  startDate: string;
  endDate: string;
  page: number;
  totalPages: number;
  tzOffset: number;
  selectedModel: string;
}

export function formatTokenCacheSum(prompt: number | null | undefined, cache: number | null | undefined): string {
  if (prompt === null || prompt === undefined) return '—';
  if (!cache) return formatNumber(prompt);
  const pct = prompt > 0 ? ((cache / prompt) * 100).toFixed(2) : '0';
  return `${formatNumber(cache)}/${formatNumber(prompt)} (${pct}%)`;
}

const styles = `
:root {
  --primary: #6366f1;
  --primary-hover: #4f46e5;
  --accent-gradient: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  --blue-gradient: linear-gradient(135deg, #3b82f6, #2563eb);
  --green-gradient: linear-gradient(135deg, #10b981, #059669);
  --orange-gradient: linear-gradient(135deg, #f59e0b, #d97706);
  --purple-gradient: linear-gradient(135deg, #8b5cf6, #7c3aed);
  --text-primary: #1f2937;
  --text-secondary: #6b7280;
  --border: #e5e7eb;
  --bg-page: #f8fafc;
  --bg-card: #ffffff;
  --radius: 12px;
  --radius-sm: 8px;
  --shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
  --shadow-lg: 0 12px 24px rgba(0, 0, 0, 0.08), 0 4px 8px rgba(0, 0, 0, 0.04);
}

/* ───── 页头 ───── */
.stats-page-title {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 0.25rem 0;
}
.stats-page-subtitle {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin-bottom: 1.5rem;
}

/* ───── 日期筛选栏 ───── */
.filter-bar {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1.25rem 1.5rem;
  margin-bottom: 1.5rem;
  box-shadow: var(--shadow);
}
.filter-form {
  display: flex;
  align-items: flex-end;
  gap: 1rem;
  flex-wrap: wrap;
}
.filter-group {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.filter-group label {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-secondary);
}
.filter-group input[type="date"] {
  padding: 0.5rem 0.75rem;
  border: 1.5px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 0.875rem;
  outline: none;
  transition: border-color 0.2s;
}
.filter-group input[type="date"]:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.12);
}
.filter-submit {
  padding: 0.5rem 1.25rem;
  background: var(--accent-gradient);
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  font-weight: 600;
  font-size: 0.875rem;
  cursor: pointer;
}
.filter-submit:hover {
  opacity: 0.9;
}
.filter-shortcuts {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
  margin-top: 0.75rem;
}
.filter-shortcuts a {
  padding: 0.35rem 0.75rem;
  background: var(--bg-page);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--text-secondary);
  text-decoration: none;
  transition: all 0.2s;
}
.filter-shortcuts a:hover {
  border-color: var(--primary);
  color: var(--primary);
  background: #eef2ff;
}
.filter-current {
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin-top: 0.6rem;
}

/* ───── 概览卡片 ───── */
.overview-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1rem;
  margin-bottom: 1.5rem;
}
@media (max-width: 900px) {
  .overview-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 480px) {
  .overview-grid { grid-template-columns: 1fr; }
}

.overview-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1.25rem 1.5rem;
  position: relative;
  overflow: hidden;
  box-shadow: var(--shadow);
  transition: transform 0.25s ease, box-shadow 0.25s ease;
}
.overview-card:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow-lg);
}
.overview-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
}
.overview-card--blue::before { background: var(--blue-gradient); }
.overview-card--green::before { background: var(--green-gradient); }
.overview-card--orange::before { background: var(--orange-gradient); }
.overview-card--purple::before { background: var(--purple-gradient); }

.overview-card-label {
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  margin-bottom: 0.4rem;
}
.overview-card--blue .overview-card-label { color: #2563eb; }
.overview-card--green .overview-card-label { color: #059669; }
.overview-card--orange .overview-card-label { color: #d97706; }
.overview-card--purple .overview-card-label { color: #7c3aed; }

.overview-card-value {
  font-size: 2rem;
  font-weight: 700;
  line-height: 1.1;
}
.overview-card--blue .overview-card-value { color: #1e40af; }
.overview-card--green .overview-card-value { color: #047857; }
.overview-card--orange .overview-card-value { color: #92400e; }
.overview-card--purple .overview-card-value { color: #5b21b6; }

.overview-card-sub {
  font-size: 0.78rem;
  color: var(--text-secondary);
  margin-top: 0.3rem;
}

/* 概览卡片内的进度条 */
.mini-bar-track {
  height: 5px;
  background: var(--border);
  border-radius: 3px;
  margin-top: 0.6rem;
  overflow: hidden;
}
.mini-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.6s ease;
}

/* ───── Token 用量卡片 ───── */
.token-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1.5rem;
  margin-bottom: 1.5rem;
  box-shadow: var(--shadow);
}
.token-card-title {
  font-size: 1.1rem;
  font-weight: 700;
  margin-bottom: 1rem;
  color: var(--text-primary);
}
.token-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1.25rem;
}
@media (max-width: 600px) {
  .token-grid { grid-template-columns: repeat(2, 1fr); }
}
.token-item-value {
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--primary);
}
.token-item-label {
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin-top: 0.15rem;
}

/* ───── 公共卡片 ───── */
.section-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1.5rem;
  margin-bottom: 1.5rem;
  box-shadow: var(--shadow);
}
.section-card-title {
  font-size: 1.1rem;
  font-weight: 700;
  margin-bottom: 1rem;
  color: var(--text-primary);
}

/* ───── 模型筛选栏 ───── */
.model-filter-bar {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}
.model-filter-btn {
  padding: 0.4rem 0.9rem;
  background: var(--bg-page);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--text-secondary);
  text-decoration: none;
  transition: all 0.2s;
}
.model-filter-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
  background: #eef2ff;
}
.model-filter-btn.active {
  background: var(--primary);
  color: #fff;
  border-color: var(--primary);
}

/* ───── 模型小卡片 ───── */
.model-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 0.875rem;
}
.model-card {
  background: var(--bg-page);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 1rem 1.25rem;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.model-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow);
}
.model-card-name {
  font-weight: 600;
  font-size: 0.95rem;
  margin-bottom: 0.3rem;
  color: var(--text-primary);
}
.model-card-requests {
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--primary);
}
.model-card-meta {
  display: flex;
  gap: 1rem;
  font-size: 0.78rem;
  margin-top: 0.4rem;
}
.model-card-success { color: #059669; }
.model-card-failed { color: #dc2626; }
.model-card-tokens { color: var(--text-secondary); }

/* ───── 小时分布 ───── */
.hour-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}
.hour-label {
  width: 130px;
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--text-secondary);
  flex-shrink: 0;
}
.hour-bar-bg {
  flex: 1;
  height: 26px;
  background: var(--bg-page);
  border-radius: 5px;
  position: relative;
  overflow: hidden;
}
.hour-bar-fill {
  height: 100%;
  border-radius: 5px;
  transition: width 0.4s ease;
}
.hour-bar-value {
  position: absolute;
  left: 0.5rem;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.8rem;
  font-weight: 600;
  white-space: nowrap;
}
.hour-meta {
  width: 180px;
  font-size: 0.75rem;
  color: var(--text-secondary);
  flex-shrink: 0;
  text-align: right;
}

/* ───── 分页表格 ───── */
.table-wrapper {
  overflow-x: auto;
}
.stats-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}
.stats-table th {
  text-align: left;
  padding: 0.6rem 0.5rem;
  font-weight: 600;
  color: var(--text-secondary);
  font-size: 0.78rem;
  border-bottom: 2px solid var(--border);
  white-space: nowrap;
}
.stats-table td {
  padding: 0.6rem 0.5rem;
  border-bottom: 1px solid #f3f4f6;
}
.stats-table tr:hover td {
  background: var(--bg-page);
}
.status-success { color: #059669; font-weight: 600; }
.status-fail { color: #dc2626; font-weight: 600; }
.error-msg {
  font-size: 0.78rem;
  color: #dc2626;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ───── 分页 ───── */
.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  margin-top: 1rem;
  font-size: 0.875rem;
}
.pagination a {
  padding: 0.4rem 0.9rem;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--primary);
  text-decoration: none;
  font-weight: 600;
  font-size: 0.85rem;
  transition: all 0.2s;
}
.pagination a:hover {
  border-color: var(--primary);
  background: #eef2ff;
}
.pagination a.disabled {
  opacity: 0.4;
  pointer-events: none;
  color: var(--text-secondary);
}
.pagination-info {
  color: var(--text-secondary);
  font-size: 0.85rem;
}

/* ───── 空状态 ───── */
.empty-state {
  text-align: center;
  padding: 3rem 1rem;
  color: var(--text-secondary);
}
.empty-state-icon {
  font-size: 3rem;
  margin-bottom: 0.75rem;
}
.empty-state-text {
  font-size: 1rem;
}
`;

// ---- 组件 ----

export const StatsView: FC<StatsViewProps> = (props) => {
  const { overview, byModel, byHour, recentRequests, userName, startDate, endDate, totalPages, tzOffset, selectedModel } = props;
  const currentPage = props.page;

  // 用 byModel 数据计算成功/失败
  const totalFailed = byModel.reduce((sum, m) => sum + m.failed, 0);
  const totalSuccessful = byModel.reduce((sum, m) => sum + m.successful, 0);
  const successPct = overview.totalRequests > 0 ? (totalSuccessful / overview.totalRequests) * 100 : 0;

  // 小时分布柱状图
  const maxHourRequests = byHour.length > 0 ? Math.max(...byHour.map((h) => h.requests)) : 1;

  // 分页链接
  const modelParam = selectedModel ? `&model=${encodeURIComponent(selectedModel)}` : '';
  const baseLink = `/user/stats?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}${modelParam}`;

  // 快捷链接
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoStr = `${sevenDaysAgo.getFullYear()}-${(sevenDaysAgo.getMonth() + 1).toString().padStart(2, '0')}-${sevenDaysAgo.getDate().toString().padStart(2, '0')}`;
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoStr = `${thirtyDaysAgo.getFullYear()}-${(thirtyDaysAgo.getMonth() + 1).toString().padStart(2, '0')}-${thirtyDaysAgo.getDate().toString().padStart(2, '0')}`;

  return (
    <UserLayout title={`使用统计 — ${userName}`} currentUser={{ name: userName, apikey: '' }}>
      <style>{styles}</style>

      {/* 标题 */}
      <h1 class="stats-page-title">📊 使用统计 — {userName}</h1>
      <p class="stats-page-subtitle">查看 API 使用情况与统计数据</p>

      {/* 日期筛选栏 */}
      <div class="filter-bar">
        <form method="get" action="/user/stats" class="filter-form" id="stats-filter-form">
          <div class="filter-group">
            <label for="start">开始日期</label>
            <input type="date" id="start" name="startDate" value={startDate.split(' ')[0]} />
          </div>
          <div class="filter-group">
            <label for="end">结束日期</label>
            <input type="date" id="end" name="endDate" value={endDate.split(' ')[0]} />
          </div>
          <input type="hidden" name="tzOffset" value={tzOffset} />
          <button type="submit" class="filter-submit">查询</button>
        </form>
        <div class="filter-shortcuts">
          <a href={`/user/stats?startDate=${todayStr}&endDate=${todayStr}`}>今天</a>
          <a href={`/user/stats?startDate=${sevenDaysAgoStr}&endDate=${todayStr}`}>最近 7 天</a>
          <a href={`/user/stats?startDate=${thirtyDaysAgoStr}&endDate=${todayStr}`}>最近 30 天</a>
        </div>
        <div class="filter-current">
          📅 当前范围：{startDate} ~ {endDate}
          {endDate === startDate ? '（当日）' : ''}
        </div>
      </div>

      {/* 空状态 */}
      {overview.totalRequests === 0 ? (
        <div class="empty-state">
          <div class="empty-state-icon">📭</div>
          <div class="empty-state-text">暂无统计数据</div>
          <p style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>所选日期范围内没有请求记录</p>
        </div>
      ) : (
        <>
          {/* 4 个概览卡片 */}
          <div class="overview-grid">
            <div class="overview-card overview-card--blue">
              <div class="overview-card-label">总请求数</div>
              <div class="overview-card-value">{formatNumber(overview.totalRequests)}</div>
              <div class="overview-card-sub">所有 API 请求</div>
            </div>
            <div class="overview-card overview-card--green">
              <div class="overview-card-label">成功率</div>
              <div class="overview-card-value">{successPct.toFixed(1)}%</div>
              <div class="overview-card-sub">{formatNumber(totalSuccessful)} / {formatNumber(overview.totalRequests)}</div>
              <div class="mini-bar-track">
                <div class="mini-bar-fill" style={{ width: `${successPct}%`, background: 'var(--green-gradient)' }} />
              </div>
            </div>
            <div class="overview-card overview-card--orange">
              <div class="overview-card-label">总 Token</div>
              <div class="overview-card-value">{formatNumber(overview.totalTokens)}</div>
              <div class="overview-card-sub">输入 + 输出</div>
            </div>
            <div class="overview-card overview-card--purple">
              <div class="overview-card-label">平均延迟</div>
              <div class="overview-card-value">{formatDuration(overview.avgDuration)}</div>
              <div class="overview-card-sub">每次请求耗时</div>
            </div>
          </div>

          {/* Token 用量明细 */}
          <div class="token-card">
            <h2 class="token-card-title">📈 Token 用量明细</h2>
            <div class="token-grid">
              <div>
                <div class="token-item-value">{formatNumber(overview.totalInputTokens)}</div>
                <div class="token-item-label">输入</div>
              </div>
              <div>
                <div class="token-item-value">{formatNumber(overview.totalCachedTokens)}</div>
                <div class="token-item-label">输入缓存{overview.totalInputTokens > 0 && <span class="cache-pct"> ({(overview.totalCachedTokens / overview.totalInputTokens * 100).toFixed(2)}%)</span>}</div>
              </div>
              <div>
                <div class="token-item-value">{formatNumber(overview.totalOutputTokens)}</div>
                <div class="token-item-label">输出</div>
              </div>
            </div>
          </div>

          {/* 按模型统计 */}
          <div class="section-card">
            <h2 class="section-card-title">🤖 按模型统计</h2>
            {byModel.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>暂无数据</p>
            ) : (
              <>
                <div class="model-filter-bar">
                  <a href={`/user/stats?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`} class={`model-filter-btn${selectedModel ? '' : ' active'}`}>全部</a>
                  {byModel.map((m) => (
                    <a href={`/user/stats?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&model=${encodeURIComponent(m.model)}`} class={`model-filter-btn${selectedModel === m.model ? ' active' : ''}`}>{m.model}</a>
                  ))}
                </div>
                <div class="model-cards">
                  {byModel.map((m) => (
                    <div class="model-card">
                      <div class="model-card-name">{m.model}</div>
                      <div class="model-card-requests">{formatNumber(m.requests)}</div>
                      <div class="model-card-meta">
                        <span class="model-card-success">✓ {formatNumber(m.successful)}</span>
                        <span class="model-card-failed">✗ {formatNumber(m.failed)}</span>
                      </div>
                      <div class="model-card-meta">
                        <span class="model-card-tokens">Token: {formatNumber(m.totalTokens)}</span>
                        <span class="model-card-tokens">{formatDuration(m.avgDuration)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* 小时分布 */}
          <div class="section-card">
            <h2 class="section-card-title">🕐 小时分布</h2>
            {byHour.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>暂无数据</p>
            ) : (
              <div id="hour-distribution-container">
                {byHour.map((h) => {
                  // 为每个小时的起始时刻构造 UTC ISO 字符串用于客户端转本地
                  // h.hour 格式是 "2026-06-14 02:00"，补上 ":00.000Z"
                  const utcHourStr = h.hour.replace(' ', 'T') + ':00.000Z';
                  const barWidth = (h.requests / maxHourRequests) * 100;
                  const barColor = barWidth > 70
                    ? 'linear-gradient(90deg, #f59e0b, #d97706)'
                    : barWidth > 40
                      ? 'linear-gradient(135deg, #10b981, #059669)'
                      : 'var(--blue-gradient)';
                  return (
                    <div class="hour-item" data-hour-utc={utcHourStr} data-requests={h.requests} data-tokens={h.totalTokens}>
                      <div class="hour-label">{h.hour}</div>
                      <div class="hour-bar-bg">
                        <div class="hour-bar-fill" style={{ width: `${barWidth}%`, background: barColor }} />
                        <span
                          class="hour-bar-value"
                          style={{
                            color: barWidth > 50 ? '#fff' : 'var(--text-primary)',
                            textShadow: barWidth > 50 ? '0 1px 2px rgba(0,0,0,0.15)' : 'none',
                          }}
                        >
                          {h.requests} 次
                        </span>
                      </div>
                      <div class="hour-meta">
                        {formatNumber(h.totalTokens)} Token
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 最近请求列表 */}
          <div class="section-card">
            <h2 class="section-card-title">📋 最近请求</h2>
            {recentRequests.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>暂无记录</p>
            ) : (
              <>
                <div class="table-wrapper">
                  <table class="stats-table">
                    <thead>
                      <tr>
                        <th>时间</th>
                        <th>用户</th>
                        <th>模型</th>
                        <th>模型组</th>
                        <th>状态码</th>
                        <th>耗时</th>
                        <th>输入Token(缓存/总输入)</th>
                        <th>输出Token</th>
                        <th>错误</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentRequests.map((r) => (
                        <tr>
                          <td style={{ whiteSpace: 'nowrap', fontSize: '0.8rem' }} data-utc={r.timestamp}>{r.timestamp}</td>
                          <td style={{ fontSize: '0.8rem' }}>{r.userName || '—'}</td>
                          <td style={{ fontWeight: 500 }}>{r.customModel}</td>
                          <td style={{ fontSize: '0.8rem' }}>{r.modelGroup || '—'}</td>
                          <td>
                            <span class={r.statusCode >= 200 && r.statusCode < 300 ? 'status-success' : 'status-fail'}>
                              {r.statusCode}
                            </span>
                          </td>
                          <td style={{ fontSize: '0.8rem' }}>{formatDuration(r.durationMs)}</td>
                          <td style={{ fontSize: '0.8rem' }}>{formatTokenCacheSum(r.promptTokens, r.cachedTokens)}</td>
                          <td style={{ fontSize: '0.8rem' }}>{formatNumber(r.completionTokens)}</td>
                          <td>
                            {r.errorMessage ? (
                              <span class="error-msg" title={r.errorMessage}>{r.errorMessage}</span>
                            ) : (
                              <span style={{ color: 'var(--text-secondary)' }}>—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* 分页 */}
                <div class="pagination">
                  {currentPage > 1 ? (
                    <a href={`${baseLink}&page=${currentPage - 1}`}>← 上一页</a>
                  ) : (
                    <a class="disabled">← 上一页</a>
                  )}
                  <span class="pagination-info">
                    第 {currentPage}/{totalPages} 页
                  </span>
                  {currentPage < totalPages ? (
                    <a href={`${baseLink}&page=${currentPage + 1}`}>下一页 →</a>
                  ) : (
                    <a class="disabled">下一页 →</a>
                  )}
                </div>
              </>
            )}
          </div>
        </>
      )}
      <script dangerouslySetInnerHTML={{ __html: `
;(function() {
  // ─── 1. Form submit: update tzOffset from browser ───
  var form = document.getElementById('stats-filter-form');
  if (form) {
    form.addEventListener('submit', function() {
      var tzInput = form.querySelector('input[name="tzOffset"]');
      if (tzInput) tzInput.value = new Date().getTimezoneOffset();
    });
  }

  // ─── 2. Convert UTC timestamps to local time ───
  var tzCells = document.querySelectorAll('[data-utc]');
  tzCells.forEach(function(el) {
    var utc = el.getAttribute('data-utc');
    if (!utc) return;
    var d = new Date(utc);
    if (isNaN(d.getTime())) return;
    var pad = function(n) { return String(n).padStart(2, '0'); };
    el.textContent = pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  });

  // ─── 3. Re-aggregate hour distribution by local hour ───
  var hourBars = document.querySelectorAll('[data-hour-utc]');
  if (hourBars.length > 0) {
    var localBuckets = {};
    hourBars.forEach(function(el) {
      var utc = el.getAttribute('data-hour-utc');
      var requests = parseInt(el.getAttribute('data-requests') || '0', 10);
      var tokens = parseInt(el.getAttribute('data-tokens') || '0', 10);
      if (!utc) return;
      var d = new Date(utc);
      if (isNaN(d.getTime())) return;
      var localKey = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':00';
      if (!localBuckets[localKey]) localBuckets[localKey] = { requests: 0, tokens: 0 };
      localBuckets[localKey].requests += requests;
      localBuckets[localKey].tokens += tokens;
    });
    // Rebuild the hour list
    var container = document.getElementById('hour-distribution-container');
    if (container) {
      var sortedKeys = Object.keys(localBuckets).sort();
      var maxLocal = sortedKeys.length > 0 ? Math.max.apply(null, sortedKeys.map(function(k) { return localBuckets[k].requests; })) : 1;
      var html = '';
      sortedKeys.forEach(function(key) {
        var bucket = localBuckets[key];
        var pct = (bucket.requests / maxLocal) * 100;
        var barColor = pct > 70
          ? 'linear-gradient(90deg, #f59e0b, #d97706)'
          : pct > 40
            ? 'linear-gradient(135deg, #10b981, #059669)'
            : 'linear-gradient(135deg, #3b82f6, #2563eb)';
        var textColor = pct > 50 ? '#fff' : '#1f2937';
        var textShadow = pct > 50 ? '0 1px 2px rgba(0,0,0,0.15)' : 'none';
        html += '<div class="hour-item">' +
          '<div class="hour-label">' + key + '</div>' +
          '<div class="hour-bar-bg">' +
            '<div class="hour-bar-fill" style="width:' + pct + '%;background:' + barColor + '"></div>' +
            '<span class="hour-bar-value" style="color:' + textColor + ';text-shadow:' + textShadow + '">' + bucket.requests + ' 次</span>' +
          '</div>' +
          '<div class="hour-meta">' + formatTokenDisplay(bucket.tokens) + ' Token</div>' +
        '</div>';
      });
      container.innerHTML = html || '<p style="color:#6b7280;font-size:0.9rem">暂无数据</p>';
    }
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function formatTokenDisplay(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }
})();
` }}></script>
    </UserLayout>
  );
};
