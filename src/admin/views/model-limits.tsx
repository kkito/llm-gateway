import { FC } from 'hono/jsx';
import { TopbarNav } from '../components/TopbarNav.js';
import type { ProviderConfig, ModelLimit } from '../../config.js';

interface LimitWithUsage extends ModelLimit {
  currentUsage: number;
  periodDesc: string;
}

interface Props {
  model: ProviderConfig;
  limits: LimitWithUsage[];
  error?: string;
  success?: string;
}

const LIMIT_TYPE_LABELS: Record<string, string> = {
  requests: '按请求次数',
  input_tokens: '按 Token 数',
  cost: '按金额',
};

const PERIOD_LABELS: Record<string, string> = {
  hours: '小时',
  day: '天',
  week: '周',
  month: '月',
};

export const ModelLimitsPage: FC<Props> = (props) => {
  const { model, limits } = props;

  return (
    <html lang="zh-CN">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>限制规则管理 - {model.customModel}</title>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=DM+Sans:wght@400;500;600&display=swap');

          :root {
            --bg-page: #f8f9fb;
            --bg-card: #ffffff;
            --text-primary: #1a1d26;
            --text-secondary: #646a7e;
            --accent-gradient: linear-gradient(135deg, hsl(245 80% 58%) 0%, hsl(268 75% 58%) 100%);
            --accent-color: hsl(245 80% 58%);
            --border-color: #e5e7eb;
            --shadow-sm: 0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06);
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

          .limits-card {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: var(--radius);
            padding: 2rem;
            box-shadow: var(--shadow-sm);
          }

          .limits-title {
            font-family: 'Outfit', sans-serif;
            font-weight: 700;
            font-size: 1.5rem;
            margin-bottom: 0.5rem;
            color: var(--text-primary);
          }

          .limits-subtitle {
            color: var(--text-secondary);
            margin-bottom: 1.5rem;
          }

          .alert {
            padding: 0.85rem 1.15rem;
            border-radius: var(--radius-sm);
            margin-bottom: 1.5rem;
            font-weight: 500;
          }

          .alert-error {
            background: #fef2f2;
            border: 1px solid #fecaca;
            color: #ef4444;
          }

          .alert-success {
            background: #f0fdf4;
            border: 1px solid #bbf7d0;
            color: #166534;
          }

          .section-title {
            font-family: 'Outfit', sans-serif;
            font-weight: 700;
            font-size: 1.25rem;
            margin: 1.5rem 0 1rem;
            color: var(--text-primary);
          }

          table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 1.5rem;
          }

          th, td {
            text-align: left;
            padding: 0.75rem;
            border-bottom: 1px solid var(--border-color);
          }

          th {
            font-weight: 600;
            color: var(--text-secondary);
            font-size: 0.85rem;
          }

          .btn {
            display: inline-flex;
            align-items: center;
            gap: 0.4rem;
            padding: 0.5rem 1rem;
            border-radius: var(--radius-sm);
            font-size: 0.85rem;
            font-weight: 600;
            text-decoration: none;
            cursor: pointer;
            border: none;
          }

          .btn-secondary {
            background: var(--bg-card);
            color: var(--text-primary);
            box-shadow: var(--shadow-sm);
            border: 1px solid var(--border-color);
          }

          .btn-danger {
            background: #fef2f2;
            color: #ef4444;
            border: 1px solid #fecaca;
            padding: 0.25rem 0.5rem;
            font-size: 0.75rem;
          }

          .btn-danger:hover {
            background: #ef4444;
            color: #fff;
          }

          .form-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1rem;
            max-width: 600px;
          }

          .form-group {
            margin-bottom: 1rem;
          }

          .form-label {
            display: block;
            font-size: 0.85rem;
            font-weight: 600;
            color: var(--text-primary);
            margin-bottom: 0.4rem;
          }

          .form-input,
          .form-select {
            width: 100%;
            padding: 0.6rem 0.8rem;
            border: 1.5px solid var(--border-color);
            border-radius: var(--radius-sm);
            font-size: 0.9rem;
            background: var(--bg-page);
            font-family: inherit;
            outline: none;
          }

          .form-input:focus,
          .form-select:focus {
            border-color: var(--accent-color);
            box-shadow: 0 0 0 3px hsl(245 80% 58% / 0.12);
          }

          .btn-submit {
            margin-top: 1rem;
            padding: 0.7rem 1.5rem;
            background: var(--accent-gradient);
            color: #fff;
            border: none;
            border-radius: var(--radius-sm);
            font-weight: 600;
            cursor: pointer;
          }

          @media (max-width: 768px) {
            .main-content { padding: 1.5rem 1rem 3rem !important; }
            .limits-card { padding: 1.5rem; }
            .form-grid { grid-template-columns: 1fr; }
          }
        `}</style>
      </head>
      <body>
        <TopbarNav title={`限制规则管理 - ${model.customModel}`} activePath="/admin/models">
          <div class="limits-card">
            <h1 class="limits-title">限制规则管理</h1>
            <p class="limits-subtitle">
              模型：<strong>{model.customModel}</strong>
              {' '}(<span style={{ color: 'var(--text-secondary)' }}>{model.realModel}</span>)
            </p>

            {props.error && (
              <div class="alert alert-error">
                <strong>错误：</strong> {props.error}
              </div>
            )}

            {props.success && (
              <div class="alert alert-success">
                <strong>成功：</strong> {props.success}
              </div>
            )}

            {/* 现有规则列表 */}
            <h2 class="section-title">现有规则</h2>

            {limits.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>暂无限制规则</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>类型</th>
                    <th>周期</th>
                    <th>数值</th>
                    <th>使用情况</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {limits.map((limit, index) => (
                    <tr key={index}>
                      <td>{LIMIT_TYPE_LABELS[limit.type] || limit.type}</td>
                      <td>
                        {limit.period === 'hours' && limit.periodValue
                          ? `${limit.periodValue} 小时`
                          : PERIOD_LABELS[limit.period] || limit.period}
                      </td>
                      <td>
                        {limit.type === 'cost'
                          ? `$${limit.max}`
                          : `${limit.max}次`}
                      </td>
                      <td>
                        <div>
                          <span style={{ fontWeight: '600' }}>
                            {limit.type === 'cost'
                              ? `$${limit.currentUsage.toFixed(4)} / $${limit.max}`
                              : `${Math.round(limit.currentUsage)} / ${limit.max}次`}
                          </span>
                          <br />
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            {limit.period === 'hours'
                              ? `过去 ${limit.periodValue || 24} 小时`
                              : limit.period === 'day'
                              ? '今日'
                              : limit.period === 'week'
                              ? '本周'
                              : '本月'}
                          </span>
                        </div>
                      </td>
                      <td>
                        <button
                          type="button"
                          class="btn btn-danger"
                          data-delete-url={`/admin/models/${encodeURIComponent(model.customModel)}/limits/delete/${index}`}
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* 添加新规则表单 */}
            <h2 class="section-title">添加规则</h2>

            <form method="post" action={`/admin/models/${encodeURIComponent(model.customModel)}/limits/add`}>
              <div class="form-grid">
                <div class="form-group">
                  <label class="form-label" for="type">
                    限制类型
                    <select class="form-select" id="type" name="type" required onchange="handleTypeChange(this)">
                      <option value="">请选择...</option>
                      <option value="requests">按请求次数</option>
                      <option value="input_tokens">按 Token 数</option>
                      <option value="cost">按金额</option>
                    </select>
                  </label>
                </div>

                <div class="form-group" id="periodLabel" style={{ display: 'none' }}>
                  <label class="form-label" for="period">
                    时间周期
                    <select class="form-select" id="period" name="period" onchange="handlePeriodChange(this)">
                      <option value="">请选择...</option>
                      <option value="hours">按小时</option>
                      <option value="day">按天</option>
                      <option value="week">按周</option>
                      <option value="month">按月</option>
                    </select>
                  </label>
                </div>

                <div class="form-group" id="periodValueLabel" style={{ display: 'none' }}>
                  <label class="form-label" for="periodValue">
                    小时数
                    <input
                      class="form-input"
                      type="number"
                      id="periodValue"
                      name="periodValue"
                      min="1"
                      placeholder="例如：4"
                    />
                  </label>
                </div>

                <div class="form-group" id="maxLabel" style={{ display: 'none' }}>
                  <label class="form-label" for="maxInput">
                    限制数值
                    <input
                      class="form-input"
                      type="number"
                      id="maxInput"
                      name="max"
                      min="1"
                      placeholder="请输入数值"
                    />
                  </label>
                </div>

                <div class="form-group" id="costMaxLabel" style={{ display: 'none' }}>
                  <label class="form-label" for="costMaxInput">
                    限制金额 (美元)
                    <input
                      class="form-input"
                      type="number"
                      id="costMaxInput"
                      name="max"
                      min="0.01"
                      step="0.01"
                      placeholder="请输入金额"
                      disabled
                    />
                  </label>
                </div>
              </div>

              <button type="submit" class="btn-submit">添加规则</button>
            </form>
          </div>

          <script
            dangerouslySetInnerHTML={{
              __html: `
                const MODEL_NAME = '${model.customModel}';

                function handleTypeChange(select) {
                  const type = select.value;
                  const periodLabel = document.getElementById('periodLabel');
                  const periodValueLabel = document.getElementById('periodValueLabel');
                  const maxLabel = document.getElementById('maxLabel');
                  const costMaxLabel = document.getElementById('costMaxLabel');

                  // 隐藏所有字段
                  periodLabel.style.display = 'none';
                  periodValueLabel.style.display = 'none';
                  maxLabel.style.display = 'none';
                  costMaxLabel.style.display = 'none';

                  // 清除必填
                  const periodSelect = periodLabel.querySelector('select');
                  const periodValueInput = periodValueLabel.querySelector('input');
                  const maxInput = document.getElementById('maxInput');
                  const costMaxInput = document.getElementById('costMaxInput');

                  periodSelect.required = false;
                  periodValueInput.required = false;
                  maxInput.required = false;
                  maxInput.disabled = true;
                  costMaxInput.required = false;
                  costMaxInput.disabled = true;

                  if (type === 'requests' || type === 'input_tokens') {
                    periodLabel.style.display = 'block';
                    periodSelect.required = true;
                    maxLabel.style.display = 'block';
                    maxInput.required = true;
                    maxInput.disabled = false;
                  } else if (type === 'cost') {
                    costMaxLabel.style.display = 'block';
                    costMaxInput.required = true;
                    costMaxInput.disabled = false;
                  }
                }

                function handlePeriodChange(select) {
                  const period = select.value;
                  const periodValueLabel = document.getElementById('periodValueLabel');
                  const maxLabel = document.getElementById('maxLabel');

                  periodValueLabel.style.display = period === 'hours' ? 'block' : 'none';
                  maxLabel.style.display = 'block';

                  const periodValueInput = periodValueLabel.querySelector('input');
                  const maxInput = document.getElementById('maxInput');

                  if (period === 'hours') {
                    periodValueInput.required = true;
                  } else {
                    periodValueInput.required = false;
                  }
                  maxInput.required = true;
                }

                // 删除功能
                document.addEventListener('DOMContentLoaded', function() {
                  document.querySelectorAll('button[data-delete-url]').forEach(function(btn) {
                    btn.addEventListener('click', function() {
                      var url = this.getAttribute('data-delete-url');
                      if (confirm('确定要删除此限制规则吗？')) {
                        var form = document.createElement('form');
                        form.method = 'POST';
                        form.action = url;
                        document.body.appendChild(form);
                        form.submit();
                      }
                    });
                  });
                });
              `
            }}
          />
        </TopbarNav>
      </body>
    </html>
  );
};
