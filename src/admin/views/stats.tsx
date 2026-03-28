import { FC } from 'hono/jsx';
import { Layout } from '../components/Layout.js';

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

  return (
    <Layout title="统计 Dashboard">
      <h1>📊 LLM Proxy 统计 Dashboard</h1>

      {/* 日期选择器 */}
      <details style={{ marginBottom: '1.5rem' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>📅 选择日期范围</summary>
        <div style={{ marginTop: '1rem', display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem' }}>按日期</label>
            <form method="get" action="/admin/stats" style={{ display: 'flex', gap: '0.5rem' }}>
              <input 
                type="date" 
                name="date" 
                value={currentType === 'date' ? currentValue : ''}
                style={{ flex: 1 }}
              />
              <button type="submit">查询</button>
            </form>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem' }}>按周</label>
            <form method="get" action="/admin/stats" style={{ display: 'flex', gap: '0.5rem' }}>
              <input 
                type="week" 
                name="week" 
                value={currentType === 'week' ? currentValue : ''}
                style={{ flex: 1 }}
              />
              <button type="submit">查询</button>
            </form>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem' }}>按月份</label>
            <form method="get" action="/admin/stats" style={{ display: 'flex', gap: '0.5rem' }}>
              <input 
                type="month" 
                name="month" 
                value={currentType === 'month' ? currentValue : ''}
                style={{ flex: 1 }}
              />
              <button type="submit">查询</button>
            </form>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem' }}>快捷选项</label>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <a href="/admin/stats" role="button" style={{ padding: '0.5rem 1rem' }}>今日</a>
            </div>
          </div>
        </div>
      </details>

      {/* 概览卡片 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <article style={{ padding: '1rem', backgroundColor: '#e3f2fd' }}>
          <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: '#1565c0' }}>总请求数</h3>
          <p style={{ margin: 0, fontSize: '2rem', fontWeight: 'bold', color: '#0d47a1' }}>{stats.totalRequests.toLocaleString()}</p>
        </article>
        <article style={{ padding: '1rem', backgroundColor: '#e8f5e9' }}>
          <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: '#2e7d32' }}>成功请求</h3>
          <p style={{ margin: 0, fontSize: '2rem', fontWeight: 'bold', color: '#1b5e20' }}>{stats.successfulRequests.toLocaleString()}</p>
        </article>
        <article style={{ padding: '1rem', backgroundColor: '#ffebee' }}>
          <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: '#c62828' }}>失败请求</h3>
          <p style={{ margin: 0, fontSize: '2rem', fontWeight: 'bold', color: '#b71c1c' }}>{stats.failedRequests.toLocaleString()}</p>
        </article>
        <article style={{ padding: '1rem', backgroundColor: '#f3e5f5' }}>
          <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: '#6a1b9a' }}>成功率</h3>
          <p style={{ margin: 0, fontSize: '2rem', fontWeight: 'bold', color: '#4a148c' }}>{successRate}%</p>
        </article>
      </div>

      {/* Token 总计 */}
      <article style={{ marginBottom: '2rem', padding: '1rem', backgroundColor: '#fff3e0' }}>
        <h2 style={{ margin: '0 0 1rem 0' }}>📈 Token 用量</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
          <div>
            <div style={{ fontSize: '0.85rem', color: '#666' }}>总输入</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#e65100' }}>{stats.totalInputTokens.toLocaleString()}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.85rem', color: '#666' }}>总输出</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#ef6c00' }}>{stats.totalOutputTokens.toLocaleString()}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.85rem', color: '#666' }}>总计</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#f57c00' }}>{stats.totalTokens.toLocaleString()}</div>
          </div>
          {stats.totalCachedTokens > 0 && (
            <div>
              <div style={{ fontSize: '0.85rem', color: '#666' }}>缓存命中</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#fb8c00' }}>{stats.totalCachedTokens.toLocaleString()}</div>
            </div>
          )}
        </div>
      </article>

      {/* 按模型统计 */}
      <article style={{ marginBottom: '2rem' }}>
        <h2>🤖 按模型统计</h2>
        {sortedModels.length === 0 ? (
          <p style={{ color: '#666' }}>暂无数据</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>模型</th>
                <th>请求数</th>
                <th>成功</th>
                <th>失败</th>
                <th>输入 Token</th>
                <th>输出 Token</th>
                <th>总计</th>
                <th>缓存</th>
              </tr>
            </thead>
            <tbody>
              {sortedModels.map(([model, modelStats]) => (
                <tr key={model}>
                  <td><strong>{model}</strong></td>
                  <td>{modelStats.requests.toLocaleString()}</td>
                  <td style={{ color: '#2e7d32' }}>{modelStats.successful.toLocaleString()}</td>
                  <td style={{ color: '#c62828' }}>{modelStats.failed.toLocaleString()}</td>
                  <td>{modelStats.inputTokens.toLocaleString()}</td>
                  <td>{modelStats.outputTokens.toLocaleString()}</td>
                  <td>{modelStats.totalTokens.toLocaleString()}</td>
                  <td>{modelStats.cachedTokens > 0 ? modelStats.cachedTokens.toLocaleString() : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </article>

      {/* 按 Provider 统计 */}
      <article style={{ marginBottom: '2rem' }}>
        <h2>☁️ 按 Provider 统计</h2>
        {sortedProviders.length === 0 ? (
          <p style={{ color: '#666' }}>暂无数据</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>请求数</th>
                <th>成功</th>
                <th>失败</th>
                <th>输入 Token</th>
                <th>输出 Token</th>
                <th>总计</th>
                <th>缓存</th>
              </tr>
            </thead>
            <tbody>
              {sortedProviders.map(([provider, providerStats]) => (
                <tr key={provider}>
                  <td><strong>{provider}</strong></td>
                  <td>{providerStats.requests.toLocaleString()}</td>
                  <td style={{ color: '#2e7d32' }}>{providerStats.successful.toLocaleString()}</td>
                  <td style={{ color: '#c62828' }}>{providerStats.failed.toLocaleString()}</td>
                  <td>{providerStats.inputTokens.toLocaleString()}</td>
                  <td>{providerStats.outputTokens.toLocaleString()}</td>
                  <td>{providerStats.totalTokens.toLocaleString()}</td>
                  <td>{providerStats.cachedTokens > 0 ? providerStats.cachedTokens.toLocaleString() : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </article>

      {/* 按日期分布（周/月视图） */}
      {sortedDates.length > 0 && (
        <article style={{ marginBottom: '2rem' }}>
          <h2>📅 按日期分布</h2>
          <table>
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
                <tr key={date}>
                  <td><strong>{date}</strong></td>
                  <td>{dateStats.requests.toLocaleString()}</td>
                  <td>{dateStats.inputTokens.toLocaleString()}</td>
                  <td>{dateStats.outputTokens.toLocaleString()}</td>
                  <td>{dateStats.totalTokens.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
      )}

      {/* 按小时分布 */}
      {sortedHours.length > 0 && (
        <article style={{ marginBottom: '2rem' }}>
          <h2>🕐 按小时分布</h2>
          <div style={{ marginTop: '1rem' }}>
            {sortedHours.map(([hour, hourStats]) => {
              const barWidth = maxHourRequests > 0 ? (hourStats.requests / maxHourRequests) * 100 : 0;
              return (
                <div key={hour} style={{ display: 'flex', alignItems: 'center', marginBottom: '0.5rem', gap: '1rem' }}>
                  <div style={{ width: '60px', fontFamily: 'monospace', fontSize: '0.9rem' }}>{hour}</div>
                  <div style={{ flex: 1, backgroundColor: '#e0e0e0', borderRadius: '4px', height: '24px', position: 'relative', overflow: 'hidden' }}>
                    <div 
                      style={{ 
                        width: `${barWidth}%`, 
                        backgroundColor: barWidth > 70 ? '#ff9800' : barWidth > 40 ? '#4caf50' : '#2196f3',
                        height: '100%',
                        transition: 'width 0.3s ease'
                      }}
                    />
                    <span style={{ 
                      position: 'absolute', 
                      left: '8px', 
                      top: '50%', 
                      transform: 'translateY(-50%)',
                      fontSize: '0.85rem',
                      fontWeight: 'bold',
                      color: barWidth > 50 ? '#fff' : '#333',
                      textShadow: barWidth > 50 ? '0 0 2px #000' : 'none'
                    }}>
                      {hourStats.requests} 次
                    </span>
                  </div>
                  <div style={{ width: '120px', fontSize: '0.85rem', color: '#666' }}>
                    输入：{hourStats.inputTokens.toLocaleString()} | 输出：{hourStats.outputTokens.toLocaleString()}
                  </div>
                </div>
              );
            })}
          </div>
        </article>
      )}

      {/* 刷新按钮 */}
      <div style={{ textAlign: 'center', marginTop: '2rem' }}>
        <a href="/admin/stats" role="button" onclick="location.reload()">🔄 刷新数据</a>
      </div>
    </Layout>
  );
};
