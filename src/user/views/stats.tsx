import { html } from 'hono/html';
import type { Stats } from '../../lib/stats-core.js';

interface StatsViewProps {
  stats: Stats;
  userName: string;
}

export function StatsView(props: StatsViewProps) {
  return html`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>使用统计 - LLM Gateway</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      margin: 0;
      padding: 2rem;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    h1 {
      color: #333;
      margin-bottom: 2rem;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 1.5rem;
    }
    .stat-card {
      background: white;
      padding: 1.5rem;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    .stat-card h3 {
      margin-top: 0;
      color: #666;
      font-size: 0.9rem;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .stat-card p {
      font-size: 2rem;
      font-weight: bold;
      color: #007bff;
      margin: 0.5rem 0 0 0;
    }
    .nav {
      margin-bottom: 2rem;
    }
    .nav a {
      color: #007bff;
      text-decoration: none;
      margin-right: 1rem;
    }
    .nav a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="nav">
      <a href="/user/main">首页</a>
      <a href="/user/stats">统计</a>
      <a href="/user/logout">登出</a>
    </div>
    <h1>使用统计 - ${props.userName}</h1>
    <div class="stats">
      <div class="stat-card">
        <h3>总请求数</h3>
        <p>${props.stats.totalRequests || 0}</p>
      </div>
      <div class="stat-card">
        <h3>总 Token 数</h3>
        <p>${props.stats.totalTokens || 0}</p>
      </div>
      <div class="stat-card">
        <h3>输入 Token</h3>
        <p>${props.stats.totalInputTokens || 0}</p>
      </div>
      <div class="stat-card">
        <h3>输出 Token</h3>
        <p>${props.stats.totalOutputTokens || 0}</p>
      </div>
    </div>
  </div>
</body>
</html>
`;
}
