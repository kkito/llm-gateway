import { FC } from 'hono/jsx';
import { TopbarNav } from '../components/TopbarNav.js';

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

interface Props {
  stats: Stats;
  dateRange: string;
  currentType: 'today' | 'date' | 'week' | 'month';
  currentValue: string;
}

export const StatsPage: FC<Props> = (props) => {
  const { stats, dateRange, currentType, currentValue } = props;

  const successRate = stats.totalRequests > 0
    ? ((stats.successfulRequests / stats.totalRequests) * 100).toFixed(1)
    : '0';

  const sortedModels = Object.entries(stats.byModel).sort((a, b) => b[1].requests - a[1].requests);
  const sortedProviders = Object.entries(stats.byProvider).sort((a, b) => b[1].requests - a[1].requests);
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
          @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=DM+Sans:wght@400;500;600;700&display=swap');

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
            font-family: 'DM Sans', system-ui, -apple-system, sans-serif;
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
            animation: fadeUp 0.6s ease-out both;
          }

          @keyframes fadeUp {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
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
            font-family: 'Outfit', sans-serif;
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
            transition: all 0.25s ease;
            letter-spacing: -0.01em;
          }
          .btn-primary {
            background: var(--accent-gradient);
            color: #fff;
            box-shadow: 0 4px 14px hsl(245 75% 58% / 0.35);
          }
          .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px hsl(245 75% 58% / 0.45);
          }
          .btn-secondary {
            background: var(--bg-card);
            color: var(--text-primary);
            box-shadow: var(--shadow-sm);
            border: 1px solid var(--border-color);
          }
          .btn-secondary:hover {
            transform: translateY(-2px);
            box-shadow: var(--shadow-md);
          }

          /* Date picker */
          .date-picker-container {
            margin-bottom: 2rem;
          }
          .date-picker-toggle {
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.7rem 1.3rem;
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: var(--radius-sm);
            font-weight: 600;
            font-size: 0.88rem;
            color: var(--text-secondary);
            list-style: none;
            transition: all 0.2s ease;
            box-shadow: var(--shadow-sm);
          }
          .date-picker-toggle:hover {
            color: var(--accent-color);
            box-shadow: var(--shadow-md);
          }
          .date-picker-toggle::marker {
            display: none;
          }
          .date-picker-toggle::before {
            content: '▼';
            font-size: 0.7rem;
            transition: transform 0.2s ease;
          }
          .date-picker-toggle[open]::before {
            transform: rotate(180deg);
          }
          .date-picker-panel {
            margin-top: 1rem;
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: var(--radius);
            padding: 1.5rem;
            box-shadow: var(--shadow-md);
          }
          .date-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1.25rem;
          }
          .date-form-group label {
            display: block;
            font-size: 0.85rem;
            font-weight: 600;
            color: var(--text-secondary);
            margin-bottom: 0.5rem;
          }
          .date-form-row {
            display: flex;
            gap: 0.5rem;
          }
          .date-form-row input, .date-form-row button {
            font-size: 0.9rem;
          }
          .date-form-row input {
            flex: 1;
            padding: 0.6rem 0.8rem;
            border: 1.5px solid var(--border-color);
            border-radius: var(--radius-sm);
            transition: border-color 0.2s ease, box-shadow 0.2s ease;
            outline: none;
          }
          .date-form-row input:focus {
            border-color: var(--accent-color);
            box-shadow: 0 0 0 3px hsl(245 80% 58% / 0.12);
          }
          .date-form-row button {
            padding: 0.6rem 1rem;
            background: var(--accent-gradient);
            color: #fff;
            border: none;
            border-radius: var(--radius-sm);
            font-weight: 600;
            cursor: pointer;
          }
          .shortcut-links {
            display: flex;
            gap: 0.5rem;
            flex-wrap: wrap;
          }
          .shortcut-btn {
            padding: 0.6rem 1rem;
            background: var(--bg-page);
            color: var(--text-primary);
            border: 1px solid var(--border-color);
            border-radius: var(--radius-sm);
            text-decoration: none;
            font-weight: 600;
            font-size: 0.85rem;
            transition: all 0.2s ease;
          }
          .shortcut-btn:hover {
            color: var(--accent-color);
            border-color: var(--accent-color);
            background: hsl(245 80% 96%);
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
            font-family: 'Outfit', sans-serif;
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
            font-family: 'Outfit', sans-serif;
            font-weight: 700;
            font-size: 1.25rem;
            margin-bottom: 1.25rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
          }
          .token-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
            gap: 1.5rem;
          }
          .token-item-value {
            font-family: 'Outfit', sans-serif;
            font-size: 1.5rem;
            font-weight: 700;
            color: var(--accent-color);
          }
          .token-item-label {
            font-size: 0.82rem;
            color: var(--text-secondary);
            margin-top: 0.2rem;
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
            font-family: 'Outfit', sans-serif;
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
            font-family: 'Outfit', sans-serif;
            font-weight: 600;
            font-size: 1rem;
            margin-bottom: 0.5rem;
            color: var(--text-primary);
          }
          .stat-mini-requests {
            font-size: 1.5rem;
            font-weight: 700;
            color: var(--accent-color);
            font-family: 'Outfit', sans-serif;
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
            font-family: 'Outfit', sans-serif;
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
            gap: 1rem;
            margin-bottom: 0.75rem;
          }
          .hour-label {
            width: 60px;
            font-family: 'Outfit', sans-serif;
            font-weight: 500;
            font-size: 0.9rem;
            color: var(--text-secondary);
          }
          .hour-bar-bg {
            flex: 1;
            height: 28px;
            background: var(--bg-page);
            border-radius: 6px;
            position: relative;
            overflow: hidden;
          }
          .hour-bar-fill {
            height: 100%;
            border-radius: 6px;
            transition: width 0.5s ease;
          }
          .hour-bar-value {
            position: absolute;
            left: 0.5rem;
            top: 50%;
            transform: translateY(-50%);
            font-size: 0.85rem;
            font-weight: 600;
          }
          .hour-meta {
            width: 180px;
            font-size: 0.8rem;
            color: var(--text-secondary);
            flex-shrink: 0;
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

          @media (max-width: 768px) {
            .main-content { padding: 1.5rem 1rem 3rem; }
            .page-title { font-size: 1.5rem; }
            .date-grid { grid-template-columns: 1fr; }
            .stat-meta { font-size: 0.75rem; }
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
                <p class="page-subtitle">{dateRange}</p>
              </div>
            </div>

            {/* 日期选择器 */}
            <div class="date-picker-container">
              <details class="date-picker-toggle">
                <summary class="date-picker-toggle">📅 选择日期范围</summary>
                <div class="date-picker-panel">
                  <div class="date-grid">
                    <div class="date-form-group">
                      <label>按日期</label>
                      <form method="get" action="/admin/stats" class="date-form-row">
                        <input type="date" name="date" value={currentType === 'date' ? currentValue : ''} />
                        <button type="submit">查询</button>
                      </form>
                    </div>
                    <div class="date-form-group">
                      <label>按周</label>
                      <form method="get" action="/admin/stats" class="date-form-row">
                        <input type="week" name="week" value={currentType === 'week' ? currentValue : ''} />
                        <button type="submit">查询</button>
                      </form>
                    </div>
                    <div class="date-form-group">
                      <label>按月份</label>
                      <form method="get" action="/admin/stats" class="date-form-row">
                        <input type="month" name="month" value={currentType === 'month' ? currentValue : ''} />
                        <button type="submit">查询</button>
                      </form>
                    </div>
                    <div class="date-form-group">
                      <label>快捷选项</label>
                      <div class="shortcut-links">
                        <a href="/admin/stats" class="shortcut-btn">今日</a>
                      </div>
                    </div>
                  </div>
                </div>
              </details>
            </div>

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
                <div class="token-item-value">{stats.totalInputTokens.toLocaleString()}</div>
                <div class="token-item-label">输入</div>
              </div>
              <div>
                <div class="token-item-value">{stats.totalOutputTokens.toLocaleString()}</div>
                <div class="token-item-label">输出</div>
              </div>
              <div>
                <div class="token-item-value">{stats.totalTokens.toLocaleString()}</div>
                <div class="token-item-label">总计</div>
              </div>
              {stats.totalCachedTokens > 0 && (
                <div>
                  <div class="token-item-value">{stats.totalCachedTokens.toLocaleString()}</div>
                  <div class="token-item-label">缓存命中</div>
                </div>
              )}
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
                    <div class="stat-mini-requests">{modelStats.requests.toLocaleString()}</div>
                    <div class="stat-mini-meta">
                      <span class="stat-mini-success">✓ {modelStats.successful.toLocaleString()}</span>
                      <span class="stat-mini-failed">✗ {modelStats.failed.toLocaleString()}</span>
                    </div>
                    <div class="stat-mini-meta">
                      <span>输入: {modelStats.inputTokens.toLocaleString()}</span>
                      <span>输出: {modelStats.outputTokens.toLocaleString()}</span>
                    </div>
                    {modelStats.cachedTokens > 0 && (
                      <div class="stat-mini-meta">
                        <span>缓存: {modelStats.cachedTokens.toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 按 Provider 统计 */}
          <div class="stats-section-card">
            <h2 class="stats-section-title">☁️ 按 Provider 统计</h2>
            {sortedProviders.length === 0 ? (
              <p class="empty-in-section">暂无数据</p>
            ) : (
              <div class="stat-mini-cards">
                {sortedProviders.map(([provider, providerStats]) => (
                  <div class="stat-mini-card">
                    <div class="stat-mini-name">{provider}</div>
                    <div class="stat-mini-requests">{providerStats.requests.toLocaleString()}</div>
                    <div class="stat-mini-meta">
                      <span class="stat-mini-success">✓ {providerStats.successful.toLocaleString()}</span>
                      <span class="stat-mini-failed">✗ {providerStats.failed.toLocaleString()}</span>
                    </div>
                    <div class="stat-mini-meta">
                      <span>Token: {providerStats.totalTokens.toLocaleString()}</span>
                    </div>
                    {providerStats.cachedTokens > 0 && (
                      <div class="stat-mini-meta">
                        <span>缓存: {providerStats.cachedTokens.toLocaleString()}</span>
                      </div>
                    )}
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
            <div class="hour-chart-card">
              <h2 class="hour-chart-title">🕐 按小时分布</h2>
              {sortedHours.map(([hour, hourStats]) => {
                const barWidth = maxHourRequests > 0 ? (hourStats.requests / maxHourRequests) * 100 : 0;
                return (
                  <div class="hour-item">
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
                      输入: {hourStats.inputTokens.toLocaleString()} | 输出: {hourStats.outputTokens.toLocaleString()}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 刷新按钮 */}
          <div class="refresh-wrapper">
            <a href="/admin/stats" class="refresh-btn" onclick="location.reload()">🔄 刷新数据</a>
          </div>
          </div>
        </TopbarNav>
      </body>
    </html>
  );
}