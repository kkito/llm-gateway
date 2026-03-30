import { FC } from 'hono/jsx';
import { Layout } from '../components/Layout.js';
import type { ProviderConfig, ProviderType, ModelLimit } from '../../config.js';

interface Props {
  model?: ProviderConfig;
  error?: string;
  apiKeyOptions?: { id: string; name: string }[];
}

const LIMIT_TYPE_OPTIONS = [
  { value: '', label: 'Free (不限制)' },
  { value: 'requests', label: '按请求次数' },
  { value: 'input_tokens', label: '按 Token 数' },
  { value: 'cost', label: '按金额' },
];

const PERIOD_OPTIONS = [
  { value: '', label: '请选择...' },
  { value: 'day', label: '按天' },
  { value: 'week', label: '按周' },
  { value: 'month', label: '按月' },
  { value: 'hours', label: '按小时' },
];

// HTML 转义函数，防止 XSS 攻击
function escapeHtml(str: string | number | undefined): string {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&amp;/g, '&amp;')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#39;');
}

// 生成限制卡片 HTML 的函数
function renderLimitCard(limit: ModelLimit | undefined, index: number): string {
  const type = limit?.type || '';
  const period = limit?.period || '';
  const max = limit?.max || '';
  const periodValue = limit?.periodValue || '';
  const inputPricePer1M = limit ? (limit as any).inputPricePer1M : '';
  const outputPricePer1M = limit ? (limit as any).outputPricePer1M : '';
  const cachedPricePer1M = limit ? (limit as any).cachedPricePer1M : '';

  const isCost = type === 'cost';
  const isRequestsOrTokens = type === 'requests' || type === 'input_tokens';
  const isHours = period === 'hours';

  return `
    <div class="limit-card" data-index="${escapeHtml(index)}" style="border: 1px solid #ddd; padding: 1rem; margin-bottom: 1rem; border-radius: 4px; background: #fafafa;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem;">
        <strong>限制规则 #${escapeHtml(index + 1)}</strong>
        <button type="button" class="secondary" onclick="removeLimitCard(this)" style="padding: 0.25rem 0.5rem; font-size: 0.875rem;">删除</button>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
        <label>
          限制类型
          <select name="limits[${escapeHtml(index)}].type" onchange="handleLimitTypeChange(this)">
            ${LIMIT_TYPE_OPTIONS.map(opt => `
              <option value="${escapeHtml(opt.value)}" ${opt.value === type ? 'selected' : ''}>${escapeHtml(opt.label)}</option>
            `).join('')}
          </select>
        </label>

        <label class="period-field" style="display: ${isRequestsOrTokens ? 'block' : 'none'}">
          时间周期
          <select name="limits[${escapeHtml(index)}].period" onchange="handlePeriodChange(this)">
            ${PERIOD_OPTIONS.map(opt => `
              <option value="${escapeHtml(opt.value)}" ${opt.value === period ? 'selected' : ''}>${escapeHtml(opt.label)}</option>
            `).join('')}
          </select>
        </label>

        <label class="period-field" style="display: ${isRequestsOrTokens ? 'block' : 'none'}">
          限制数值
          <input
            type="number"
            name="limits[${escapeHtml(index)}].max"
            value="${escapeHtml(max)}"
            min="1"
            ${isRequestsOrTokens ? 'required' : ''}
            placeholder="请输入限制数值"
          />
        </label>

        <label class="hours-field" style="display: ${isHours ? 'block' : 'none'}">
          小时数
          <input
            type="number"
            name="limits[${escapeHtml(index)}].periodValue"
            value="${escapeHtml(periodValue)}"
            min="1"
            ${isHours ? 'required' : ''}
            placeholder="请输入小时数"
          />
        </label>

        <label class="cost-field" style="display: ${isCost ? 'block' : 'none'}">
          限制金额 (美元)
          <input
            type="number"
            name="limits[${escapeHtml(index)}].max"
            value="${escapeHtml(max)}"
            min="0.01"
            step="0.01"
            ${isCost ? 'required' : ''}
            placeholder="请输入限制金额"
          />
        </label>
      </div>

      <div class="price-config" style="display: ${isCost ? 'block' : 'none'}; margin-top: 1rem; padding-top: 1rem; border-top: 1px dashed #ccc;">
        <strong style="font-size: 0.875rem; color: #666;">价格配置 (按 Token 计费)</strong>
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem; margin-top: 0.5rem;">
          <label>
            输入单价 ($/百万 token)
            <input
              type="number"
              name="limits[${escapeHtml(index)}].inputPricePer1M"
              value="${escapeHtml(inputPricePer1M)}"
              min="0.01"
              step="0.01"
              ${isCost ? 'required' : ''}
              placeholder="请输入"
            />
          </label>
          <label>
            输出单价 ($/百万 token)
            <input
              type="number"
              name="limits[${escapeHtml(index)}].outputPricePer1M"
              value="${escapeHtml(outputPricePer1M)}"
              min="0"
              step="0.01"
              placeholder="请输入（可选）"
            />
          </label>
          <label>
            缓存单价 ($/百万 token)
            <input
              type="number"
              name="limits[${escapeHtml(index)}].cachedPricePer1M"
              value="${escapeHtml(cachedPricePer1M)}"
              min="0"
              step="0.01"
              placeholder="请输入（可选）"
            />
          </label>
        </div>
      </div>
    </div>
  `;
}

// 生成新的空白限制卡片 HTML
function renderNewLimitCard(index: number): string {
  return `
    <div class="limit-card" data-index="${escapeHtml(index)}" style="border: 1px solid #ddd; padding: 1rem; margin-bottom: 1rem; border-radius: 4px; background: #fafafa;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem;">
        <strong>限制规则 #${escapeHtml(index + 1)}</strong>
        <button type="button" class="secondary" onclick="removeLimitCard(this)" style="padding: 0.25rem 0.5rem; font-size: 0.875rem;">删除</button>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
        <label>
          限制类型
          <select name="limits[${escapeHtml(index)}].type" onchange="handleLimitTypeChange(this)">
            <option value="">Free (不限制)</option>
            <option value="requests">按请求次数</option>
            <option value="input_tokens">按 Token 数</option>
            <option value="cost">按金额</option>
          </select>
        </label>

        <label class="period-field" style="display: none;">
          时间周期
          <select name="limits[${escapeHtml(index)}].period" onchange="handlePeriodChange(this)">
            <option value="">请选择...</option>
            <option value="day">按天</option>
            <option value="week">按周</option>
            <option value="month">按月</option>
            <option value="hours">按小时</option>
          </select>
        </label>

        <label class="period-field" style="display: none;">
          限制数值
          <input type="number" name="limits[${escapeHtml(index)}].max" min="1" placeholder="请输入限制数值" />
        </label>

        <label class="hours-field" style="display: none;">
          小时数
          <input type="number" name="limits[${escapeHtml(index)}].periodValue" min="1" placeholder="请输入小时数" />
        </label>

        <label class="cost-field" style="display: none;">
          限制金额 (美元)
          <input type="number" name="limits[${escapeHtml(index)}].max" min="0.01" step="0.01" placeholder="请输入限制金额" />
        </label>
      </div>

      <div class="price-config" style="display: none; margin-top: 1rem; padding-top: 1rem; border-top: 1px dashed #ccc;">
        <strong style="font-size: 0.875rem; color: #666;">价格配置 (按 Token 计费)</strong>
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem; margin-top: 0.5rem;">
          <label>
            输入单价 ($/百万 token)
            <input type="number" name="limits[${escapeHtml(index)}].inputPricePer1M" min="0" step="0.01" placeholder="请输入" />
          </label>
          <label>
            输出单价 ($/百万 token)
            <input type="number" name="limits[${escapeHtml(index)}].outputPricePer1M" min="0" step="0.01" placeholder="请输入（可选）" />
          </label>
          <label>
            缓存单价 ($/百万 token)
            <input type="number" name="limits[${escapeHtml(index)}].cachedPricePer1M" min="0" step="0.01" placeholder="请输入（可选）" />
          </label>
        </div>
      </div>
    </div>
  `;
}

// JavaScript 代码 - 作为字符串生成
function generateLimitScript(initialCount: number): string {
  const script = `
let limitCardCount = ${initialCount};

function addLimitCard() {
  const container = document.getElementById('limitsContainer');
  const index = limitCardCount;
  const cardHtml = '${renderNewLimitCard(0).replace(/0/g, "' + index + '")}';
  container.insertAdjacentHTML('beforeend', cardHtml);
  limitCardCount++;
  renumberCards();
}

function removeLimitCard(button) {
  const card = button.closest('.limit-card');
  card.remove();
  renumberCards();
}

function renumberCards() {
  const cards = document.querySelectorAll('.limit-card');
  cards.forEach((card, idx) => {
    card.dataset.index = idx;
    const title = card.querySelector('strong');
    if (title) title.textContent = '限制规则 #' + (idx + 1);

    const selects = card.querySelectorAll('select');
    selects.forEach(sel => {
      const name = sel.name;
      if (name.startsWith('limits[')) {
        sel.name = name.replace(/limits\\[\\d+\\]/, 'limits[' + idx + ']');
      }
    });

    const inputs = card.querySelectorAll('input');
    inputs.forEach(inp => {
      const name = inp.name;
      if (name && name.startsWith('limits[')) {
        inp.name = name.replace(/limits\\[\\d+\\]/, 'limits[' + idx + ']');
      }
    });
  });
  limitCardCount = cards.length;
}

function handleLimitTypeChange(select) {
  const card = select.closest('.limit-card');
  const type = select.value;

  const periodFields = card.querySelectorAll('.period-field');
  const hoursField = card.querySelector('.hours-field');
  const costField = card.querySelector('.cost-field');
  const priceConfig = card.querySelector('.price-config');

  // 获取所有需要动态设置 required 的输入框
  const limitMaxInput = card.querySelector('[name$="].max"]');
  const periodValueInput = card.querySelector('[name$="].periodValue"]');
  const inputPriceInput = card.querySelector('[name$="].inputPricePer1M"]');

  // 先清除所有动态 required
  if (limitMaxInput) limitMaxInput.required = false;
  if (periodValueInput) periodValueInput.required = false;
  if (inputPriceInput) inputPriceInput.required = false;

  if (type === 'requests' || type === 'input_tokens') {
    periodFields.forEach(f => f.style.display = 'block');
    costField.style.display = 'none';
    priceConfig.style.display = 'none';

    // 按请求次数/按 Token 数时，限制数值为必填
    if (limitMaxInput) limitMaxInput.required = true;

    const periodSelect = card.querySelector('[name$="].period"]');
    if (periodSelect && periodSelect.value === 'hours') {
      hoursField.style.display = 'block';
      // 按小时时，小时数为必填
      if (periodValueInput) periodValueInput.required = true;
    } else {
      hoursField.style.display = 'none';
    }
  } else if (type === 'cost') {
    periodFields.forEach(f => f.style.display = 'none');
    hoursField.style.display = 'none';
    costField.style.display = 'block';
    priceConfig.style.display = 'block';

    // 按金额时，限制金额和输入单价格为必填
    if (limitMaxInput) limitMaxInput.required = true;
    if (inputPriceInput) inputPriceInput.required = true;
  } else {
    periodFields.forEach(f => f.style.display = 'none');
    hoursField.style.display = 'none';
    costField.style.display = 'none';
    priceConfig.style.display = 'none';
  }
}

function handlePeriodChange(select) {
  const card = select.closest('.limit-card');
  const period = select.value;
  const hoursField = card.querySelector('.hours-field');
  const periodValueInput = card.querySelector('[name$="].periodValue"]');

  if (period === 'hours') {
    hoursField.style.display = 'block';
    // 按小时时，小时数为必填
    if (periodValueInput) periodValueInput.required = true;
  } else {
    hoursField.style.display = 'none';
    if (periodValueInput) periodValueInput.required = false;
  }
}
`;
  return script;
}

export const ModelFormPage: FC<Props> = (props) => {
  const isEdit = !!props.model;
  const formAction = isEdit ? `/admin/models/edit/${escapeHtml(props.model!.customModel)}` : '/admin/models';
  const existingLimits = props.model?.limits || [];

  // 预渲染已有配置的限制卡片
  const existingCardsHtml = existingLimits.map((limit, i) => renderLimitCard(limit, i)).join('\n');

  // 生成客户端 JavaScript
  const limitScript = generateLimitScript(existingLimits.length);

  // 用于 JSX 安全渲染的辅助函数
  const safeValue = (val: string | undefined) => val ? escapeHtml(val) : '';

  return (
    <Layout title={isEdit ? '编辑模型' : '新增模型'}>
      <h1>{isEdit ? '编辑模型' : '新增模型'}</h1>

      {props.error && (
        <article aria-label="错误提示" style={{ backgroundColor: '#fee2e2', color: '#991b1b' }}>
          <strong>错误：</strong> {props.error}
        </article>
      )}

      <form method="post" action={formAction}>
        <label>
          自定义模型名称
          <input
            name="customModel"
            type="text"
            placeholder="例如：my-gpt4"
            value={safeValue(props.model?.customModel)}
            required
          />
          <small>调用 API 时使用此名称</small>
        </label>

        <label>
          实际模型名称
          <input
            name="realModel"
            type="text"
            placeholder="例如：gpt-4"
            value={safeValue(props.model?.realModel)}
            required
          />
          <small>上游 API 支持的模型名称</small>
        </label>

        <label>
          API Provider
          <select name="provider" required>
            <option value="">请选择...</option>
            <option
              value="openai"
              selected={props.model?.provider === 'openai'}
            >
              OpenAI
            </option>
            <option
              value="anthropic"
              selected={props.model?.provider === 'anthropic'}
            >
              Anthropic
            </option>
          </select>
        </label>

        <label>
          Base URL
          <input
            name="baseUrl"
            type="url"
            placeholder="例如：https://api.openai.com"
            value={safeValue(props.model?.baseUrl)}
            required
          />
          <small>API 提供商的地址</small>
        </label>

        <label>
          API Key
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <select
              name="apiKeySource"
              onchange="const manualInput = document.getElementById('apiKeyManual'); if (this.value === 'manual') { manualInput.disabled = false; manualInput.required = true; manualInput.focus(); } else { manualInput.disabled = true; manualInput.value = ''; manualInput.required = false; }"
              style={{ maxWidth: '300px' }}
            >
              <option value="manual">手动输入...</option>
              {props.apiKeyOptions?.map((opt) => (
                <option value={opt.id}>{opt.name}</option>
              ))}
            </select>
            <input
              id="apiKeyManual"
              name="apiKey"
              type="password"
              placeholder={isEdit ? '留空则保持原密钥不变' : '请输入 API Key'}
              value={isEdit ? '' : safeValue(props.model?.apiKey)}
              required={!isEdit}
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
            <small>可以选择已保存的 API Key，或手动输入</small>
          </div>
          {isEdit && <small>留空则保持原密钥不变</small>}
        </label>

        <label>
          描述
          <textarea
            name="desc"
            placeholder="请输入模型描述（可选）"
            rows={3}
          >
            {props.model?.desc || ''}
          </textarea>
          <small>用于记录模型的用途或备注</small>
        </label>

        {/* 使用限制配置区域 */}
        <fieldset style="border: 1px solid #ddd; padding: 1rem; margin-top: 1rem;">
          <legend style="font-weight: bold; padding: 0 0.5rem;">使用限制</legend>

          <div id="limitsContainer">
            {existingLimits.length > 0 ? (
              <div dangerouslySetInnerHTML={{ __html: existingCardsHtml }} />
            ) : null}
          </div>

          <button
            type="button"
            id="addLimitBtn"
            onclick="addLimitCard()"
            style={{ marginTop: '0.5rem' }}
          >
            + 添加限制规则
          </button>
        </fieldset>

        <button type="submit">{isEdit ? '保存修改' : '添加模型'}</button>
        <a href="/admin/models" role="button" class="secondary" style="margin-left: 0.5rem">
          取消
        </a>
      </form>

      {/* JavaScript for dynamic limit card management */}
      <script dangerouslySetInnerHTML={{ __html: limitScript }} />
    </Layout>
  );
};