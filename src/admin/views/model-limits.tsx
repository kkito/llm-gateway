import { FC } from 'hono/jsx';
import { Layout } from '../components/Layout.js';
import type { ProviderConfig, ModelLimit } from '../../config.js';

interface Props {
  model: ProviderConfig;
  limits: ModelLimit[];
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

  // 格式化限制规则显示
  function formatLimit(limit: ModelLimit): string {
    const typeLabel = LIMIT_TYPE_LABELS[limit.type] || limit.type;
    const periodLabel = PERIOD_LABELS[limit.period] || limit.period;
    
    if (limit.type === 'cost') {
      return `${typeLabel}: $${limit.max}/${periodLabel}`;
    }
    
    if (limit.period === 'hours' && limit.periodValue) {
      return `${typeLabel}: ${limit.max}次/${limit.periodValue}小时`;
    }
    
    return `${typeLabel}: ${limit.max}次/${periodLabel}`;
  }

  return (
    <Layout title={`限制规则管理 - ${model.customModel}`}>
      <h1>限制规则管理</h1>

      <p style={{ marginBottom: '1rem', color: '#666' }}>
        模型：<strong>{model.customModel}</strong>
        {' '}(<span style={{ color: '#999' }}>{model.realModel}</span>)
      </p>

      <a href="/admin/models" role="button" class="secondary" style={{ marginRight: '0.5rem' }}>
        ← 返回模型列表
      </a>

      {props.error && (
        <article aria-label="错误提示" style={{ backgroundColor: '#fee2e2', color: '#991b1b', marginTop: '1rem' }}>
          <strong>错误：</strong> {props.error}
        </article>
      )}

      {props.success && (
        <article aria-label="成功提示" style={{ backgroundColor: '#d1fae5', color: '#065f46', marginTop: '1rem' }}>
          <strong>成功：</strong> {props.success}
        </article>
      )}

      {/* 现有规则列表 */}
      <section style={{ marginTop: '1.5rem' }}>
        <h2>现有规则</h2>

        {limits.length === 0 ? (
          <p style={{ color: '#666', fontStyle: 'italic' }}>暂无限制规则</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>类型</th>
                <th>周期</th>
                <th>数值</th>
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
                    <button
                      type="button"
                      class="secondary"
                      data-delete-url={`/admin/models/${encodeURIComponent(model.customModel)}/limits/delete/${index}`}
                      style={{ fontSize: '12px', padding: '4px 8px' }}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 添加新规则表单 */}
      <section style={{ marginTop: '1.5rem', borderTop: '1px solid #ddd', paddingTop: '1.5rem' }}>
        <h2>添加规则</h2>

        <form method="post" action={`/admin/models/${encodeURIComponent(model.customModel)}/limits/add`}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', maxWidth: '600px' }}>
            <label>
              限制类型
              <select name="type" required onchange="handleTypeChange(this)">
                <option value="">请选择...</option>
                <option value="requests">按请求次数</option>
                <option value="input_tokens">按 Token 数</option>
                <option value="cost">按金额</option>
              </select>
            </label>

            <label id="periodLabel" style={{ display: 'none' }}>
              时间周期
              <select name="period" onchange="handlePeriodChange(this)">
                <option value="">请选择...</option>
                <option value="hours">按小时</option>
                <option value="day">按天</option>
                <option value="week">按周</option>
                <option value="month">按月</option>
              </select>
            </label>

            <label id="periodValueLabel" style={{ display: 'none' }}>
              小时数
              <input
                type="number"
                name="periodValue"
                min="1"
                placeholder="例如：4"
              />
            </label>

            <label id="maxLabel" style={{ display: 'none' }}>
              限制数值
              <input
                type="number"
                name="max"
                min="1"
                placeholder="请输入数值"
              />
            </label>

            <label id="costMaxLabel" style={{ display: 'none' }}>
              限制金额 (美元)
              <input
                type="number"
                name="max"
                min="0.01"
                step="0.01"
                placeholder="请输入金额"
              />
            </label>
          </div>

          <button type="submit" style={{ marginTop: '1rem' }}>添加规则</button>
        </form>
      </section>

      <script
        dangerouslySetInnerHTML={{
          __html: `
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
              const maxInput = maxLabel.querySelector('input');
              const costMaxInput = costMaxLabel.querySelector('input');

              periodSelect.required = false;
              periodValueInput.required = false;
              maxInput.required = false;
              costMaxInput.required = false;

              if (type === 'requests' || type === 'input_tokens') {
                periodLabel.style.display = 'block';
                periodSelect.required = true;
              } else if (type === 'cost') {
                costMaxLabel.style.display = 'block';
                costMaxInput.required = true;
              }
            }

            function handlePeriodChange(select) {
              const period = select.value;
              const periodValueLabel = document.getElementById('periodValueLabel');
              const maxLabel = document.getElementById('maxLabel');

              periodValueLabel.style.display = period === 'hours' ? 'block' : 'none';
              maxLabel.style.display = 'block';

              const periodValueInput = periodValueLabel.querySelector('input');
              const maxInput = maxLabel.querySelector('input');

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
    </Layout>
  );
};
