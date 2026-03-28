import { FC } from 'hono/jsx';
import { UserLayout } from '../components/Layout.js';
import type { Stats } from '../../lib/stats-core.js';
import type { UserApiKey } from '../../config.js';

interface Props {
  stats: Stats;
  dateRange: string;
  currentType: 'today' | 'date' | 'week' | 'month';
  currentValue: string;
  currentUser: UserApiKey;
}

export const StatsPage: FC<Props> = (props) => {
  return (
    <UserLayout title="使用统计 - LLM Gateway" currentUser={props.currentUser}>
      <style
        dangerouslySetInnerHTML={{
          __html: `
            :root {
              --primary: #6366f1;
              --primary-hover: #4f46e5;
              --card-bg: #ffffff;
              --text-primary: #1f2937;
              --text-secondary: #6b7280;
              --border: #e5e7eb;
              --bg: #f8fafc;
              --radius: 12px;
              --radius-sm: 8px;
              --shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
              --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
            }

            * {
              box-sizing: border-box;
            }

            body {
              background: var(--bg);
              min-height: 100vh;
            }

            .container {
              max-width: 1200px;
              margin: 0 auto;
              padding: 1.5rem;
            }

            .page-header {
              margin-bottom: 1.5rem;
            }

            .page-header h1 {
              font-size: 1.5rem;
              font-weight: 700;
              color: var(--text-primary);
              margin: 0 0 0.5rem 0;
            }

            .page-header p {
              font-size: 0.875rem;
              color: var(--text-secondary);
              margin: 0;
            }

            .stats-cards {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
              gap: 1rem;
              margin-bottom: 1.5rem;
            }

            .stat-card {
              background: var(--card-bg);
              border-radius: var(--radius);
              padding: 1.25rem;
              box-shadow: var(--shadow);
              transition: all 0.3s ease;
            }

            .stat-card:hover {
              transform: translateY(-2px);
              box-shadow: var(--shadow-lg);
            }

            .stat-card .label {
              font-size: 0.75rem;
              color: var(--text-secondary);
              text-transform: uppercase;
              letter-spacing: 0.05em;
              margin-bottom: 0.5rem;
            }

            .stat-card .value {
              font-size: 1.75rem;
              font-weight: 700;
              color: var(--text-primary);
            }

            .stat-card .value.primary {
              color: var(--primary);
            }

            .stats-table {
              background: var(--card-bg);
              border-radius: var(--radius);
              box-shadow: var(--shadow);
              overflow: hidden;
            }

            .stats-table table {
              width: 100%;
              border-collapse: collapse;
            }

            .stats-table th,
            .stats-table td {
              padding: 0.875rem 1rem;
              text-align: left;
              border-bottom: 1px solid var(--border);
            }

            .stats-table th {
              background: #f9fafb;
              font-size: 0.75rem;
              font-weight: 600;
              color: var(--text-secondary);
              text-transform: uppercase;
              letter-spacing: 0.05em;
            }

            .stats-table tr:last-child td {
              border-bottom: none;
            }

            .stats-table tr:hover {
              background: #f9fafb;
            }

            .model-name {
              font-weight: 500;
              color: var(--text-primary);
            }

            .filter-form {
              display: flex;
              gap: 0.75rem;
              margin-bottom: 1rem;
              flex-wrap: wrap;
              align-items: center;
            }

            .filter-form select,
            .filter-form input {
              padding: 0.5rem 0.75rem;
              font-size: 0.875rem;
              border: 1px solid var(--border);
              border-radius: var(--radius-sm);
              background: white;
              cursor: pointer;
            }

            .filter-form select:focus,
            .filter-form input:focus {
              outline: none;
              border-color: var(--primary);
              box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
            }

            .filter-form button {
              padding: 0.5rem 1rem;
              font-size: 0.875rem;
              font-weight: 500;
              color: white;
              background: var(--primary);
              border: none;
              border-radius: var(--radius-sm);
              cursor: pointer;
              transition: all 0.2s ease;
            }

            .filter-form button:hover {
              background: var(--primary-hover);
            }
          `
        }}
      />

      <div class="container">
        <div class="page-header">
          <h1>📊 使用统计</h1>
          <p>查看您的 API 调用统计信息</p>
        </div>

        {/* 筛选器 */}
        <form class="filter-form" method="get" action="/user/stats">
          <select name="type" id="filter-type" onchange="this.form.submit()">
            <option value="today" selected={props.currentType === 'today'}>今日</option>
            <option value="date" selected={props.currentType === 'date'}>按日期</option>
            <option value="week" selected={props.currentType === 'week'}>按周</option>
            <option value="month" selected={props.currentType === 'month'}>按月</option>
          </select>

          {props.currentType === 'date' && (
            <input
              type="date"
              name="date"
              value={props.currentValue}
              onchange="this.form.submit()"
            />
          )}

          {props.currentType === 'week' && (
            <input
              type="week"
              name="week"
              value={props.currentValue}
              onchange="this.form.submit()"
            />
          )}

          {props.currentType === 'month' && (
            <input
              type="month"
              name="month"
              value={props.currentValue}
              onchange="this.form.submit()"
            />
          )}
        </form>

        {/* 统计卡片 */}
        <div class="stats-cards">
          <div class="stat-card">
            <div class="label">总请求数</div>
            <div class="value primary">{props.stats.totalRequests}</div>
          </div>
          <div class="stat-card">
            <div class="label">总 Token 数</div>
            <div class="value">{props.stats.totalTokens.toLocaleString()}</div>
          </div>
          <div class="stat-card">
            <div class="label">输入 Token</div>
            <div class="value">{props.stats.totalInputTokens.toLocaleString()}</div>
          </div>
          <div class="stat-card">
            <div class="label">输出 Token</div>
            <div class="value">{props.stats.totalOutputTokens.toLocaleString()}</div>
          </div>
        </div>

        {/* 模型统计表格 */}
        <div class="stats-table">
          <table>
            <thead>
              <tr>
                <th>模型名称</th>
                <th>请求数</th>
                <th>总 Token</th>
                <th>输入 Token</th>
                <th>输出 Token</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(props.stats.byModel).map(([modelName, model]) => (
                <tr key={modelName}>
                  <td class="model-name">{modelName}</td>
                  <td>{model.requests}</td>
                  <td>{model.totalTokens.toLocaleString()}</td>
                  <td>{model.inputTokens.toLocaleString()}</td>
                  <td>{model.outputTokens.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </UserLayout>
  );
};
