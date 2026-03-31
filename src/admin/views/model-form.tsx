import { FC } from 'hono/jsx';
import { Layout } from '../components/Layout.js';
import type { ProviderConfig } from '../../config.js';

interface Props {
  model?: ProviderConfig;
  error?: string;
  apiKeyOptions?: { id: string; name: string }[];
}

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

export const ModelFormPage: FC<Props> = (props) => {
  const isEdit = !!props.model;
  const formAction = isEdit ? `/admin/models/edit/${escapeHtml(props.model!.customModel)}` : '/admin/models';

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

        <button type="submit">{isEdit ? '保存修改' : '添加模型'}</button>
        <a href="/admin/models" role="button" class="secondary" style="margin-left: 0.5rem">
          取消
        </a>
      </form>

      {isEdit && props.model && (
        <section style={{ marginTop: '2rem', borderTop: '1px solid #ddd', paddingTop: '1.5rem' }}>
          <h2>使用限制</h2>
          <p style={{ color: '#666', marginBottom: '1rem' }}>
            在独立页面管理模型的使用限制规则
          </p>
          <a
            href={`/admin/models/${encodeURIComponent(props.model.customModel)}/limits`}
            role="button"
            class="secondary"
          >
            管理限制规则 →
          </a>
        </section>
      )}
    </Layout>
  );
};
