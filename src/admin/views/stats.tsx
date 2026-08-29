import { FC } from 'hono/jsx';
import { TopbarNav } from '../components/TopbarNav.js';
import { formatNumber, formatDuration } from '../../lib/format.js';

function formatTokenCacheSum(prompt: number | null | undefined, cache: number | null | undefined): string {
  if (prompt === null || prompt === undefined) return '—';
  if (!cache) return formatNumber(prompt);
  const pct = prompt > 0 ? ((cache / prompt) * 100).toFixed(1) : '0';
  return `${formatNumber(cache)}/${formatNumber(prompt)} (${pct}%)`;
}

interface ModelStats {
  requests: number;
  successful: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens: number;
}

interface Stats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  byModel: Record<string, ModelStats>;
  byProvider: Record<string, ModelStats>;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCachedTokens: number;
  byHour?: Record<string, ModelStats>;
  byDate?: Record<string, ModelStats>;
}

interface RecentRequestEntry {
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
  ttftMs: number | null;
  tps: number | null;
  errorMessage: string | null;
}

interface Props {
  stats: Stats;
  dateRange: string;
  currentType: 'today' | 'date' | 'week' | 'month';
  currentValue: string;
  recentRequests?: RecentRequestEntry[];
  page?: number;
  totalPages?: number;
  totalItems?: number;
  userNames?: string[];
  modelNames?: string[];
  selectedUser?: string;
  selectedModel?: string;
  startDate?: string;
  endDate?: string;
  tzOffset?: number;
  timezone?: string;
  avgTtftMs?: number | null;
  avgTps?: number | null;
}

function buildBaseUrl(startDate: string, endDate: string, timezone: string, selectedUser: string, selectedModel: string): string {
  let url = `/admin/stats?startDate=${startDate}&endDate=${endDate}&timezone=${encodeURIComponent(timezone)}`;
  if (selectedUser) url += `&userName=${selectedUser}`;
  if (selectedModel) url += `&model=${selectedModel}`;
  return url;
}

export const StatsPage: FC<Props> = (props) => {
  const {
    stats, dateRange, currentType, currentValue,
    recentRequests = [], page = 1, totalPages = 1, totalItems = 0,
    userNames = [], modelNames = [], selectedUser = '', selectedModel = '',
    startDate = '', endDate = '', tzOffset = 0, timezone = 'UTC',
    avgTtftMs = null, avgTps = null,
  } = props;

  const successRate = stats.totalRequests > 0
    ? ((stats.successfulRequests / stats.totalRequests) * 100).toFixed(1)
    : '0';

  const sortedModels = Object.entries(stats.byModel).sort((a, b) => b[1].requests - a[1].requests);
  const sortedHours = stats.byHour ? Object.entries(stats.byHour).sort((a, b) => a[0].localeCompare(b[0])) : [];
  const sortedDates = stats.byDate ? Object.entries(stats.byDate).sort((a, b) => a[0].localeCompare(b[0])) : [];

  // 计算小时分布的最大值，用于柱状图宽度
  const maxHourRequests = sortedHours.length > 0
    ? Math.max(...sortedHours.map(([, s]) => s.requests))
    : 1;

  // 计算百分比
  const successPct = stats.totalRequests > 0 ? (stats.successfulRequests / stats.totalRequests) * 100 : 0;
  const failPct = stats.totalRequests > 0 ? (stats.failedRequests / stats.totalRequests) * 100 : 0;

  return (
    <html lang="zh-CN">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>统计 Dashboard - LLM Gateway</title>
        <style>{`
          :root {
            --bg-page: #f8f9fb;
            --bg-card: #ffffff;
            --text-primary: #1a1d26;
            --text-secondary: #646a7e;
            --accent-gradient: linear-gradient(135deg, hsl(245 80% 58%) 0%, hsl(268 75% 58%) 100%);
            --accent-color: hsl(245 80% 58%);
            --blue-gradient: linear-gradient(135deg, #3b82f6, #2563eb);
            --blue-bg: #eff6ff;
            --green-gradient: linear-gradient(135deg, #10b981, #059669);
            --green-bg: #f0fdf4;
            --red-gradient: linear-gradient(135deg, #ef4444, #dc2626);
            --red-bg: #fef2f2;
            --purple-gradient: linear-gradient(135deg, #8b5cf6, #7c3aed);
            --purple-bg: #f5f3ff;
            --orange-bg: #fff7ed;
            --border-color: #e5e7eb;
            --shadow-sm: 0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06);
            --shadow-md: 0 4px 12px rgba(0,0,0,0.06), 0 2px 4px rgba(0,0,0,0.04);
            --shadow-lg: 0 12px 24px rgba(0,0,0,0.08), 0 4px 8px rgba(0,0,0,0.04);
            --radius: 14px;
            --radius-sm: 8px;
          }

          * { margin: 0; padding: 0; box-sizing: border-box; }

          body {
            font-family: system-ui, -apple-system, sans-serif;
            background: var(--bg-page);
            color: var(--text-primary);
            line-height: 1.6;
            min-height: 100vh;
          }

          /* ───── 主内容区 ───── */
          .main-content {
            max-width: 1280px;
            margin: 0 auto;
            padding: 2.5rem 2rem 4rem;
          }

          /* Header */
          .page-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 2rem;
            flex-wrap: wrap;
            gap: 1rem;
          }
          .page-title {
            font-family: system-ui, -apple-system, sans-serif;
            font-weight: 700;
            font-size: 2rem;
            letter-spacing: -0.03em;
            color: var(--text-primary);
          }
          .page-subtitle {
            color: var(--text-secondary);
            font-size: 0.95rem;
            margin-top: 0.3rem;
          }

          /* Buttons */
          .btn {
            display: inline-flex;
            align-items: center;
            gap: 0.4rem;
            padding: 0.7rem 1.3rem;
            border-radius: var(--radius-sm);
            font-size: 0.88rem;
            font-weight: 600;
            text-decoration: none;
            cursor: pointer;
            border: none;
            letter-spacing: -0.01em;
          }
          .btn-primary {
            background: var(--accent-gradient);
            color: #fff;
            box-shadow: 0 4px 14px hsl(245 75% 58% / 0.35);
          }
          .btn-secondary {
            background: var(--bg-card);
            color: var(--text-primary);
            box-shadow: var(--shadow-sm);
            border: 1px solid var(--border-color);
          }

          /* ───── 日期筛选栏 ───── */
          .filter-bar {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: var(--radius);
            padding: 1.25rem 1.5rem;
            margin-bottom: 1.5rem;
            box-shadow: var(--shadow-sm);
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
            border: 1.5px solid var(--border-color);
            border-radius: var(--radius-sm);
            font-size: 0.88rem;
            outline: none;
            transition: border-color 0.2s;
          }
          .filter-group input[type="date"]:focus {
            border-color: var(--accent-color);
            box-shadow: 0 0 0 3px hsl(245 80% 58% / 0.12);
          }
          .filter-submit {
            padding: 0.5rem 1.25rem;
            background: var(--accent-gradient);
            color: #fff;
            border: none;
            border-radius: var(--radius-sm);
            font-weight: 600;
            font-size: 0.88rem;
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
            border: 1px solid var(--border-color);
            border-radius: var(--radius-sm);
            font-size: 0.8rem;
            font-weight: 500;
            color: var(--text-secondary);
            text-decoration: none;
            transition: all 0.2s;
          }
          .filter-shortcuts a:hover {
            border-color: var(--accent-color);
            color: var(--accent-color);
            background: hsl(245 80% 96%);
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
            gap: 1.25rem;
            margin-bottom: 2rem;
          }
          @media (max-width: 900px) {
            .overview-grid { grid-template-columns: repeat(2, 1fr); }
          }
          @media (max-width: 480px) {
            .overview-grid { grid-template-columns: 1fr; }
          }

          .overview-card {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: var(--radius);
            padding: 1.75rem;
            position: relative;
            overflow: hidden;
            transition: all 0.3s ease;
            box-shadow: var(--shadow-sm);
          }
          .overview-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 3px;
            opacity: 1;
            transition: height 0.3s ease;
          }
          .overview-card--blue::before { background: var(--blue-gradient); }
          .overview-card--green::before { background: var(--green-gradient); }
          .overview-card--red::before { background: var(--red-gradient); }
          .overview-card--purple::before { background: var(--purple-gradient); }
          .overview-card--blue { background: var(--blue-bg); }
          .overview-card--green { background: var(--green-bg); }
          .overview-card--red { background: var(--red-bg); }
          .overview-card--purple { background: var(--purple-bg); }

          .overview-card:hover {
            transform: translateY(-4px);
            box-shadow: var(--shadow-lg);
          }
          .overview-card:hover::before {
            height: 4px;
          }

          .overview-card-label {
            font-size: 0.85rem;
            font-weight: 600;
            margin-bottom: 0.5rem;
          }
          .overview-card--blue .overview-card-label { color: #2563eb; }
          .overview-card--green .overview-card-label { color: #059669; }
          .overview-card--red .overview-card-label { color: #dc2626; }
          .overview-card--purple .overview-card-label { color: #7c3aed; }

          .overview-card-value {
            font-family: system-ui, -apple-system, sans-serif;
            font-size: 2.25rem;
            font-weight: 700;
            line-height: 1.1;
          }
          .overview-card--blue .overview-card-value { color: #1e40af; }
          .overview-card--green .overview-card-value { color: #047857; }
          .overview-card--red .overview-card-value { color: #b91c1c; }
          .overview-card--purple .overview-card-value { color: #5b21b6; }

          .overview-card-sub {
            font-size: 0.8rem;
            color: var(--text-secondary);
            margin-top: 0.4rem;
          }

          /* Mini bar inside overview */
          .mini-bar-track {
            height: 6px;
            background: var(--border-color);
            border-radius: 3px;
            margin-top: 0.75rem;
            overflow: hidden;
          }
          .mini-bar-fill {
            height: 100%;
            border-radius: 3px;
            transition: width 0.8s ease;
          }

          /* ───── Token 用量卡片 ───── */
          .token-card {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: var(--radius);
            padding: 2rem;
            margin-bottom: 1.5rem;
            box-shadow: var(--shadow-sm);
            transition: all 0.3s ease;
          }
          .token-card:hover {
            transform: translateY(-3px);
            box-shadow: var(--shadow-md);
          }
          .token-card-title {
            font-family: system-ui, -apple-system, sans-serif;
            font-weight: 700;
            font-size: 1.25rem;
            margin-bottom: 1.25rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
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
            font-family: system-ui, -apple-system, sans-serif;
            font-size: 1.4rem;
            font-weight: 700;
            color: var(--accent-color);
          }
          .token-item-label {
            font-size: 0.8rem;
            color: var(--text-secondary);
            margin-top: 0.15rem;
          }

          /* ───── 统计表格卡片 ───── */
          .stats-section-card {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: var(--radius);
            padding: 2rem;
            margin-bottom: 1.5rem;
            box-shadow: var(--shadow-sm);
            transition: all 0.3s ease;
            overflow: hidden;
          }
          .stats-section-card:hover {
            transform: translateY(-3px);
            box-shadow: var(--shadow-md);
          }
          .stats-section-title {
            font-family: system-ui, -apple-system, sans-serif;
            font-weight: 700;
            font-size: 1.1rem;
            margin-bottom: 1.25rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            color: var(--text-primary);
          }
          .stats-table-wrapper {
            overflow-x: auto;
          }
          .stats-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.9rem;
          }
          .stats-table th {
            text-align: left;
            padding: 0.75rem 0.5rem;
            font-weight: 600;
            color: var(--text-secondary);
            font-size: 0.82rem;
            border-bottom: 2px solid var(--border-color);
            white-space: nowrap;
          }
          .stats-table td {
            padding: 0.75rem 0.5rem;
            border-bottom: 1px solid #f3f4f6;
          }
          .stats-table tr:hover td {
            background: var(--bg-page);
          }
          .stats-table .model-name {
            font-weight: 600;
            color: var(--text-primary);
          }
          .stat-green { color: #059669; font-weight: 600; }
          .stat-red { color: #dc2626; font-weight: 600; }

          /* 模型/Provider 小卡片 */
          .stat-mini-cards {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
            gap: 1rem;
            margin-top: 1rem;
          }
          .stat-mini-card {
            background: var(--bg-page);
            border: 1px solid var(--border-color);
            border-radius: var(--radius-sm);
            padding: 1.25rem;
            transition: all 0.25s ease;
          }
          .stat-mini-card:hover {
            transform: translateY(-2px);
            box-shadow: var(--shadow-sm);
          }
          .stat-mini-name {
            font-family: system-ui, -apple-system, sans-serif;
            font-weight: 600;
            font-size: 1rem;
            margin-bottom: 0.5rem;
            color: var(--text-primary);
          }
          .stat-mini-requests {
            font-size: 1.5rem;
            font-weight: 700;
            color: var(--accent-color);
            font-family: system-ui, -apple-system, sans-serif;
          }
          .stat-mini-meta {
            display: flex;
            gap: 1rem;
            font-size: 0.8rem;
            margin-top: 0.5rem;
          }
          .stat-mini-success { color: #059669; }
          .stat-mini-failed { color: #dc2626; }

          /* Empty state */
          .empty-in-section {
            color: var(--text-secondary);
            font-size: 0.95rem;
            padding: 1rem 0;
          }

          /* ───── 小时分布 ───── */
          .hour-chart-card {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: var(--radius);
            padding: 2rem;
            margin-bottom: 1.5rem;
            box-shadow: var(--shadow-sm);
          }
          .hour-chart-title {
            font-family: system-ui, -apple-system, sans-serif;
            font-weight: 700;
            font-size: 1.1rem;
            margin-bottom: 1.5rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
          }
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
            height: 20px;
            background: var(--bg-page);
            border-radius: 4px;
            position: relative;
            overflow: hidden;
          }
          .hour-bar-fill {
            height: 100%;
            border-radius: 4px;
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
            width: 280px;
            font-size: 0.75rem;
            color: var(--text-secondary);
            flex-shrink: 0;
            text-align: right;
            white-space: nowrap;
          }

          /* Refresh button */
          .refresh-wrapper {
            text-align: center;
            margin-top: 2rem;
          }
          .refresh-btn {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.7rem 1.5rem;
            background: var(--bg-card);
            color: var(--text-secondary);
            border: 1px solid var(--border-color);
            border-radius: var(--radius-sm);
            text-decoration: none;
            font-weight: 600;
            font-size: 0.88rem;
            transition: all 0.25s ease;
            box-shadow: var(--shadow-sm);
          }
          .refresh-btn:hover {
            color: var(--accent-color);
            border-color: var(--accent-color);
            box-shadow: var(--shadow-md);
            transform: translateY(-2px);
          }

          /* ───── 模型筛选按钮 ───── */
          .model-filter-bar {
            display: flex;
            gap: 0.5rem;
            flex-wrap: wrap;
            margin-bottom: 1.5rem;
          }
          .model-filter-btn {
            padding: 0.45rem 0.9rem;
            border: 1px solid var(--border-color);
            border-radius: 20px;
            font-size: 0.82rem;
            font-weight: 500;
            cursor: pointer;
            text-decoration: none;
            color: var(--text-secondary);
            background: var(--bg-card);
            transition: all 0.2s;
          }
          .model-filter-btn:hover {
            border-color: var(--accent-color);
            color: var(--accent-color);
          }
          .model-filter-btn.active {
            background: var(--accent-gradient);
            color: #fff;
            border-color: transparent;
          }

          /* ───── 请求列表 ───── */
          .request-list-card {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: var(--radius);
            padding: 2rem;
            margin-bottom: 1.5rem;
            box-shadow: var(--shadow-sm);
            overflow: hidden;
          }
          .request-list-title {
            font-weight: 700;
            font-size: 1.1rem;
            margin-bottom: 1rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
          }
          .request-list-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 1rem;
            flex-wrap: wrap;
            margin-bottom: 1rem;
          }
          .request-list-header .request-list-title {
            margin-bottom: 0;
          }
          .avg-metrics {
            display: flex;
            gap: 0.5rem;
            flex-wrap: wrap;
            font-size: 0.78rem;
          }
          .avg-pill {
            display: inline-flex;
            align-items: center;
            gap: 0.35rem;
            padding: 0.3rem 0.7rem;
            border-radius: 999px;
            font-weight: 500;
            border: 1px solid transparent;
            white-space: nowrap;
          }
          .avg-pill--ttft {
            background: var(--purple-bg);
            color: #6d28d9;
            border-color: #ede9fe;
          }
          .avg-pill--tps {
            background: var(--green-bg);
            color: #047857;
            border-color: #d1fae5;
          }
          .avg-pill--empty {
            background: var(--bg-page);
            color: var(--text-secondary);
            border-color: var(--border-color);
          }
          .avg-pill-label {
            font-size: 0.72rem;
            opacity: 0.85;
          }
          .avg-pill-value {
            font-weight: 700;
            font-family: system-ui, -apple-system, sans-serif;
          }
          .request-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.82rem;
          }
          .request-table th {
            text-align: left;
            padding: 0.6rem 0.5rem;
            font-weight: 600;
            color: var(--text-secondary);
            font-size: 0.78rem;
            border-bottom: 2px solid var(--border-color);
            white-space: nowrap;
          }
          .request-table td {
            padding: 0.55rem 0.5rem;
            border-bottom: 1px solid #f3f4f6;
            max-width: 200px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .request-table tr:hover td {
            background: var(--bg-page);
          }
          .status-badge {
            display: inline-block;
            padding: 0.15rem 0.5rem;
            border-radius: 10px;
            font-size: 0.75rem;
            font-weight: 600;
          }
          .status-ok { background: #dcfce7; color: #166534; }
          .status-err { background: #fee2e2; color: #991b1b; }

          /* ───── 分页 ───── */
          .pagination {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 0.5rem;
            margin-top: 1.5rem;
          }
          .pagination a, .pagination span {
            padding: 0.4rem 0.75rem;
            border: 1px solid var(--border-color);
            border-radius: var(--radius-sm);
            text-decoration: none;
            font-size: 0.85rem;
            font-weight: 500;
            color: var(--text-secondary);
            background: var(--bg-card);
            transition: all 0.2s;
          }
          .pagination a:hover {
            border-color: var(--accent-color);
            color: var(--accent-color);
          }
          .pagination .active {
            background: var(--accent-gradient);
            color: #fff;
            border-color: transparent;
          }
          .pagination .disabled {
            opacity: 0.4;
            pointer-events: none;
          }

          @media (max-width: 768px) {
            .main-content { padding: 1.5rem 1rem 3rem; }
            .page-title { font-size: 1.5rem; }
            .date-grid { grid-template-columns: 1fr; }
            .stat-meta { font-size: 0.75rem; }
            .filter-bar { flex-direction: column; }
            .request-table { font-size: 0.75rem; }
          }
        `}</style>
      </head>
      <body>
        <TopbarNav title="统计 Dashboard" activePath="/admin/stats">
          <div>
            {/* 页头 */}
            <div class="page-header">
              <div>
                <h1 class="page-title">统计 Dashboard</h1>
              </div>
            </div>

            {/* 日期筛选栏 */}
            <div class="filter-bar">
              <form method="get" action="/admin/stats" class="filter-form" id="stats-filter-form">
                <div class="filter-group">
                  <label for="start">开始日期</label>
                  <input type="date" id="start" name="startDate" value={startDate} />
                </div>
                <div class="filter-group">
                  <label for="end">结束日期</label>
                  <input type="date" id="end" name="endDate" value={endDate} />
                </div>
                <input type="hidden" name="timezone" value={timezone} />
                {selectedUser && <input type="hidden" name="userName" value={selectedUser} />}
                {selectedModel && <input type="hidden" name="model" value={selectedModel} />}
                <button type="submit" class="filter-submit">查询</button>
              </form>
              <div class="filter-shortcuts" id="filter-shortcuts">
                <a href="#" data-range="today" onclick="return setDateRange('today')">今天</a>
                <a href="#" data-range="7days" onclick="return setDateRange('7days')">最近 7 天</a>
                <a href="#" data-range="30days" onclick="return setDateRange('30days')">最近 30 天</a>
              </div>
              <div class="filter-current">
                📅 当前范围：{startDate} ~ {endDate}
                {endDate === startDate ? '（当日）' : ''}
              </div>
            </div>

            {/* 用户筛选按钮 */}
            {userNames.length > 0 && (
              <div class="model-filter-bar">
                <a href={`${buildBaseUrl(startDate, endDate, timezone, '', selectedModel)}`} class={`model-filter-btn ${!selectedUser ? 'active' : ''}`}>全部用户</a>
                {userNames.map(u => (
                  <a href={`${buildBaseUrl(startDate, endDate, timezone, u, selectedModel)}`} class={`model-filter-btn ${u === selectedUser ? 'active' : ''}`}>{u}</a>
                ))}
              </div>
            )}

            {/* 模型筛选按钮 */}
            {modelNames.length > 0 && (
              <div class="model-filter-bar">
                <a href={`${buildBaseUrl(startDate, endDate, timezone, selectedUser, '')}`} class={`model-filter-btn ${!selectedModel ? 'active' : ''}`}>全部模型</a>
                {modelNames.map(m => (
                  <a href={`${buildBaseUrl(startDate, endDate, timezone, selectedUser, m)}`} class={`model-filter-btn ${m === selectedModel ? 'active' : ''}`}>{m}</a>
                ))}
              </div>
            )}

          {/* 概览卡片 */}
          <div class="overview-grid">
            {/* 总请求数 */}
            <div class="overview-card overview-card--blue">
              <div class="overview-card-label">总请求数</div>
              <div class="overview-card-value">{stats.totalRequests.toLocaleString()}</div>
              <div class="overview-card-sub">{dateRange}</div>
            </div>
            {/* 成功请求 */}
            <div class="overview-card overview-card--green">
              <div class="overview-card-label">成功请求</div>
              <div class="overview-card-value">{stats.successfulRequests.toLocaleString()}</div>
              <div class="overview-card-sub">成功率 {successRate}%</div>
              <div class="mini-bar-track">
                <div class="mini-bar-fill" style={{ width: `${successPct}%`, background: 'var(--green-gradient)' }} />
              </div>
            </div>
            {/* 失败请求 */}
            <div class="overview-card overview-card--red">
              <div class="overview-card-label">失败请求</div>
              <div class="overview-card-value">{stats.failedRequests.toLocaleString()}</div>
              <div class="overview-card-sub">失败率 {failPct.toFixed(1)}%</div>
              <div class="mini-bar-track">
                <div class="mini-bar-fill" style={{ width: `${failPct}%`, background: 'var(--red-gradient)' }} />
              </div>
            </div>
            {/* 成功率 */}
            <div class="overview-card overview-card--purple">
              <div class="overview-card-label">成功率</div>
              <div class="overview-card-value">{successRate}%</div>
              <div class="overview-card-sub">{stats.successfulRequests} / {stats.totalRequests}</div>
              <div class="mini-bar-track">
                <div class="mini-bar-fill" style={{ width: `${successPct}%`, background: 'var(--purple-gradient)' }} />
              </div>
            </div>
          </div>

          {/* Token 用量 */}
          <div class="token-card">
            <h2 class="token-card-title">📈 Token 用量</h2>
            <div class="token-grid">
              <div>
                <div class="token-item-value">{formatNumber(stats.totalInputTokens)}</div>
                <div class="token-item-label">输入</div>
              </div>
              <div>
                <div class="token-item-value">{formatNumber(stats.totalCachedTokens)}</div>
                <div class="token-item-label">输入缓存{stats.totalInputTokens > 0 && <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}> ({(stats.totalCachedTokens / stats.totalInputTokens * 100).toFixed(1)}%)</span>}</div>
              </div>
              <div>
                <div class="token-item-value">{formatNumber(stats.totalOutputTokens)}</div>
                <div class="token-item-label">输出</div>
              </div>
              <div>
                <div class="token-item-value">{formatNumber(stats.totalTokens)}</div>
                <div class="token-item-label">总计</div>
              </div>
            </div>
          </div>

          {/* 按模型统计 - 卡片列表 */}
          <div class="stats-section-card">
            <h2 class="stats-section-title">🤖 按模型统计</h2>
            {sortedModels.length === 0 ? (
              <p class="empty-in-section">暂无数据</p>
            ) : (
              <div class="stat-mini-cards">
                {sortedModels.map(([model, modelStats]) => (
                  <div class="stat-mini-card">
                    <div class="stat-mini-name">{model}</div>
                    <div class="stat-mini-requests">{formatNumber(modelStats.requests)}</div>
                    <div class="stat-mini-meta">
                      <span class="stat-mini-success">✓ {formatNumber(modelStats.successful)}</span>
                      <span class="stat-mini-failed">✗ {formatNumber(modelStats.failed)}</span>
                    </div>
                    <div class="stat-mini-meta">
                      <span>输入: {formatNumber(modelStats.inputTokens)}</span>
                      <span>输出: {formatNumber(modelStats.outputTokens)}</span>
                    </div>
                    <div class="stat-mini-meta">
                      <span>输入缓存: {formatNumber(modelStats.cachedTokens)}{modelStats.inputTokens > 0 && <span> ({(modelStats.cachedTokens / modelStats.inputTokens * 100).toFixed(1)}%)</span>}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 按日期分布（周/月视图） */}
          {sortedDates.length > 0 && (
            <div class="stats-section-card">
              <h2 class="stats-section-title">📅 按日期分布</h2>
              <div class="stats-table-wrapper">
                <table class="stats-table">
                  <thead>
                    <tr>
                      <th>日期</th>
                      <th>请求数</th>
                      <th>输入 Token</th>
                      <th>输出 Token</th>
                      <th>总计</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedDates.map(([date, dateStats]) => (
                      <tr>
                        <td><strong>{date}</strong></td>
                        <td>{dateStats.requests.toLocaleString()}</td>
                        <td>{dateStats.inputTokens.toLocaleString()}</td>
                        <td>{dateStats.outputTokens.toLocaleString()}</td>
                        <td>{dateStats.totalTokens.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 按小时分布 */}
          {sortedHours.length > 0 && (
            <div class="stats-section-card">
              <h2 class="stats-section-title">🕐 按小时分布</h2>
              <div id="hour-distribution-container">
                {sortedHours.map(([hour, hourStats]) => {
                  // hour 来自 SQL strftime('%Y-%m-%d %H:00', timestamp) — UTC 时间
                  // 补上 ":00.000Z" 转为 ISO 字符串，供客户端 JS 转本地
                  const utcHourStr = hour.replace(' ', 'T') + ':00.000Z';
                  const barWidth = maxHourRequests > 0 ? (hourStats.requests / maxHourRequests) * 100 : 0;
                  return (
                    <div class="hour-item" data-hour-utc={utcHourStr} data-requests={hourStats.requests} data-tokens={hourStats.totalTokens}>
                      <div class="hour-label">{hour}</div>
                      <div class="hour-bar-bg">
                        <div
                          class="hour-bar-fill"
                          style={{
                            width: `${barWidth}%`,
                            background: barWidth > 70
                              ? 'linear-gradient(90deg, #fb923c, #f97316)'
                              : barWidth > 40
                                ? 'var(--green-gradient)'
                                : 'var(--blue-gradient)'
                          }}
                        />
                        <span
                          class="hour-bar-value"
                          style={{
                            color: barWidth > 50 ? '#fff' : 'var(--text-primary)',
                            textShadow: barWidth > 50 ? '0 1px 2px rgba(0,0,0,0.15)' : 'none'
                          }}
                        >
                          {hourStats.requests} 次
                        </span>
                      </div>
                      <div class="hour-meta">
                        输入: {formatNumber(hourStats.inputTokens)} | 输出: {formatNumber(hourStats.outputTokens)} | 缓存: {hourStats.inputTokens > 0 ? (hourStats.cachedTokens / hourStats.inputTokens * 100).toFixed(1) : '0'}%
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 请求列表 */}
          {recentRequests.length > 0 && (
            <div class="request-list-card">
              <div class="request-list-header">
                <h2 class="request-list-title">📋 请求列表 (共 {totalItems.toLocaleString()} 条)</h2>
                {(avgTtftMs != null || avgTps != null) ? (
                  <div class="avg-metrics">
                    {avgTtftMs != null && (
                      <span class="avg-pill avg-pill--ttft">
                        <span class="avg-pill-label">平均 TTFT</span>
                        <span class="avg-pill-value">{formatDuration(avgTtftMs)}</span>
                      </span>
                    )}
                    {avgTps != null && (
                      <span class="avg-pill avg-pill--tps">
                        <span class="avg-pill-label">平均 TPS</span>
                        <span class="avg-pill-value">{avgTps.toFixed(1)} tok/s</span>
                      </span>
                    )}
                  </div>
                ) : (
                  <div class="avg-metrics">
                    <span class="avg-pill avg-pill--empty">
                      <span class="avg-pill-label">仅流式请求可计算 TTFT / TPS</span>
                    </span>
                  </div>
                )}
              </div>
              <div class="stats-table-wrapper">
                <table class="request-table">
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>用户</th>
                      <th>模型</th>
                      <th>状态</th>
                      <th>耗时</th>
                      <th>TTFT</th>
                      <th>TPS</th>
                      <th>输出</th>
                      <th>缓存/输入 (占比)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentRequests.map(req => (
                      <tr>
                        <td>{new Date(req.timestamp).toLocaleString()}</td>
                        <td>{req.userName || '-'}</td>
                        <td title={req.customModel}>{req.customModel}</td>
                        <td>
                          <span class={`status-badge ${req.statusCode >= 200 && req.statusCode < 300 ? 'status-ok' : 'status-err'}`}>
                            {req.statusCode}
                          </span>
                        </td>
                        <td>{req.durationMs != null ? formatDuration(req.durationMs) : '—'}</td>
                        <td>{req.ttftMs != null ? formatDuration(req.ttftMs) : '—'}</td>
                        <td>{req.tps != null ? `${req.tps.toFixed(1)} tok/s` : '—'}</td>
                        <td>{req.completionTokens != null ? req.completionTokens.toLocaleString() : '-'}</td>
                        <td>{formatTokenCacheSum(req.promptTokens, req.cachedTokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* 分页 */}
              {totalPages > 1 && (
                <div class="pagination">
                  {page > 1 && (
                    <a href={`?startDate=${startDate}&endDate=${endDate}&timezone=${encodeURIComponent(timezone)}${selectedUser ? '&userName=' + selectedUser : ''}${selectedModel ? '&model=' + selectedModel : ''}&page=${page - 1}`}>上一页</a>
                  )}
                  {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                    const p = i + 1;
                    return (
                      <a
                        href={`?startDate=${startDate}&endDate=${endDate}&timezone=${encodeURIComponent(timezone)}${selectedUser ? '&userName=' + selectedUser : ''}${selectedModel ? '&model=' + selectedModel : ''}&page=${p}`}
                        class={p === page ? 'active' : ''}
                      >
                        {p}
                      </a>
                    );
                  })}
                  {page < totalPages && (
                    <a href={`?startDate=${startDate}&endDate=${endDate}&timezone=${encodeURIComponent(timezone)}${selectedUser ? '&userName=' + selectedUser : ''}${selectedModel ? '&model=' + selectedModel : ''}&page=${page + 1}`}>下一页</a>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 刷新按钮 */}
          <div class="refresh-wrapper">
            <a href="/admin/stats" class="refresh-btn" onclick="location.reload()">🔄 刷新数据</a>
          </div>
          <script dangerouslySetInnerHTML={{ __html: `
(function() {
  var browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // ─── 0. 首次访问：没有 timezone 参数时自动 redirect 补上 ───
  var url = new URL(window.location.href);
  if (!url.searchParams.has('timezone')) {
    url.searchParams.set('timezone', browserTimezone);
    window.location.replace(url.toString());
    return;
  }

  // ─── 1. 表单提交：注入当前时区 ───
  var form = document.getElementById('stats-filter-form');
  if (form) {
    var tzInput = form.querySelector('input[name="timezone"]');
    if (!tzInput) {
      tzInput = document.createElement('input');
      tzInput.type = 'hidden';
      tzInput.name = 'timezone';
      form.appendChild(tzInput);
    }
    form.addEventListener('submit', function() {
      tzInput.value = browserTimezone;
    });
  }

  // ─── 2. 快捷日期链接：客户端生成 ───
  var pad = function(n) { return String(n).padStart(2, '0'); };
  function localDateStr(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function buildDateRangeUrl(rangeType) {
    var today = localDateStr(new Date());
    var baseUrl = new URL(window.location.href);
    baseUrl.searchParams.set('startDate', today);
    baseUrl.searchParams.set('endDate', today);
    if (rangeType === '7days') {
      var d = new Date(); d.setDate(d.getDate() - 7);
      baseUrl.searchParams.set('startDate', localDateStr(d));
    } else if (rangeType === '30days') {
      var d = new Date(); d.setDate(d.getDate() - 30);
      baseUrl.searchParams.set('startDate', localDateStr(d));
    }
    baseUrl.searchParams.set('timezone', browserTimezone);
    baseUrl.searchParams.delete('page');
    return baseUrl.toString();
  }
  window.setDateRange = function(rangeType) {
    window.location.href = buildDateRangeUrl(rangeType);
    return false;
  };

  // ─── 3. 将按小时分布的 UTC 时间重新聚合为本地时间 ───
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
          '<div class="hour-meta">' + bucket.tokens + ' Token</div>' +
        '</div>';
      });
      container.innerHTML = html;
    }
  }
})();
` }}></script>
          </div>
        </TopbarNav>
      </body>
    </html>
  );
}