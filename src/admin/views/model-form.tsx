import { FC } from 'hono/jsx';
import { TopbarNav } from '../components/TopbarNav.js';
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
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const ModelFormPage: FC<Props> = (props) => {
  const isEdit = !!props.model;
  const formAction = isEdit ? `/admin/models/edit/${escapeHtml(props.model!.customModel)}` : '/admin/models';

  // 用于 JSX 安全渲染的辅助函数
  const safeValue = (val: string | undefined) => val ? escapeHtml(val) : '';

  return (
    <html lang="zh-CN">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{isEdit ? '编辑模型' : '新增模型'} - LLM Gateway</title>
        <style>{`
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
            font-family: system-ui, -apple-system, sans-serif;
            background: var(--bg-page);
            color: var(--text-primary);
            line-height: 1.6;
            min-height: 100vh;
          }

          .form-card {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: var(--radius);
            padding: 2rem;
            box-shadow: var(--shadow-sm);
          }

          .form-title {
            font-family: system-ui, -apple-system, sans-serif;
            font-weight: 700;
            font-size: 1.5rem;
            margin-bottom: 1.5rem;
            color: var(--text-primary);
          }

          .form-group {
            margin-bottom: 1.25rem;
          }

          .form-label {
            display: block;
            font-size: 0.85rem;
            font-weight: 600;
            color: var(--text-primary);
            margin-bottom: 0.4rem;
          }

          .form-input,
          .form-select,
          .form-textarea {
            width: 100%;
            padding: 0.7rem 0.9rem;
            border: 1.5px solid var(--border-color);
            border-radius: var(--radius-sm);
            font-size: 0.92rem;
            background: var(--bg-page);
            font-family: inherit;
            outline: none;
          }

          .form-input:focus,
          .form-select:focus,
          .form-textarea:focus {
            border-color: var(--accent-color);
            box-shadow: 0 0 0 3px hsl(245 80% 58% / 0.12);
            background: var(--bg-card);
          }

          .form-hint {
            display: block;
            font-size: 0.78rem;
            color: var(--text-secondary);
            margin-top: 0.35rem;
          }

          .form-actions {
            display: flex;
            gap: 0.75rem;
            margin-top: 1.5rem;
          }

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

          .error-banner {
            background: #fef2f2;
            border: 1px solid #fecaca;
            color: #ef4444;
            padding: 0.85rem 1.15rem;
            border-radius: var(--radius-sm);
            margin-bottom: 1.5rem;
            font-weight: 500;
          }

          .limits-section {
            margin-top: 2rem;
            padding-top: 1.5rem;
            border-top: 1px solid var(--border-color);
          }

          .limits-title {
            font-family: system-ui, -apple-system, sans-serif;
            font-weight: 700;
            font-size: 1.25rem;
            margin-bottom: 1rem;
          }

          @media (max-width: 768px) {
            .main-content { padding: 1.5rem 1rem 3rem !important; }
            .form-card { padding: 1.5rem; }
          }
        `}</style>
      </head>
      <body>
        <TopbarNav title={isEdit ? '编辑模型' : '新增模型'} activePath="/admin/models">
          <div class="form-card">
            <h1 class="form-title">{isEdit ? '编辑模型' : '新增模型'}</h1>

            {props.error && (
              <div class="error-banner">
                <strong>错误：</strong> {props.error}
              </div>
            )}

            <form method="post" action={formAction}>
              <div class="form-group">
                <label class="form-label" for="customModel">
                  自定义模型名称
                  <input
                    class="form-input"
                    id="customModel"
                    name="customModel"
                    type="text"
                    placeholder="例如：my-gpt4"
                    value={safeValue(props.model?.customModel)}
                    required
                  />
                  <span class="form-hint">调用 API 时使用此名称</span>
                </label>
              </div>

              <div class="form-group">
                <label class="form-label" for="realModel">
                  实际模型名称
                  <input
                    class="form-input"
                    id="realModel"
                    name="realModel"
                    type="text"
                    placeholder="例如：gpt-4"
                    value={safeValue(props.model?.realModel)}
                    required
                  />
                  <span class="form-hint">上游 API 支持的模型名称</span>
                </label>
              </div>

              <div class="form-group">
                <label class="form-label" for="provider">
                  API Provider
                  <select class="form-select" id="provider" name="provider" required>
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
              </div>

              <div class="form-group">
                <label class="form-label" for="baseUrl">
                  Base URL
                  <input
                    class="form-input"
                    id="baseUrl"
                    name="baseUrl"
                    type="url"
                    placeholder="例如：https://api.openai.com"
                    value={safeValue(props.model?.baseUrl)}
                    required
                  />
                  <span class="form-hint">API 提供商的地址</span>
                </label>
              </div>

              <div class="form-group">
                <label class="form-label" for="apiKeySource">
                  API Key
                  <div style="display: flex; flexDirection: column; gap: 0.5rem;">
                    <select
                      class="form-select"
                      id="apiKeySource"
                      name="apiKeySource"
                      onchange="const manualInput = document.getElementById('apiKeyManual'); if (this.value === 'manual') { manualInput.disabled = false; manualInput.required = true; manualInput.focus(); } else { manualInput.disabled = true; manualInput.value = ''; manualInput.required = false; }"
                    >
                      <option value="manual">手动输入...</option>
                      {props.apiKeyOptions?.map((opt) => (
                        <option value={opt.id}>{opt.name}</option>
                      ))}
                    </select>
                    <input
                      class="form-input"
                      id="apiKeyManual"
                      name="apiKey"
                      type="password"
                      placeholder={isEdit ? '留空则保持原密钥不变' : '请输入 API Key'}
                      value={isEdit ? '' : safeValue(props.model?.apiKey)}
                      required={!isEdit}
                    />
                    <span class="form-hint">可以选择已保存的 API Key，或手动输入</span>
                  </div>
                  {isEdit && <span class="form-hint">留空则保持原密钥不变</span>}
                </label>
              </div>

              <div class="form-group">
                <label class="form-label" for="desc">
                  描述
                  <textarea
                    class="form-textarea"
                    id="desc"
                    name="desc"
                    placeholder="请输入模型描述（可选）"
                    rows={3}
                  >
                    {props.model?.desc || ''}
                  </textarea>
                  <span class="form-hint">用于记录模型的用途或备注</span>
                </label>
              </div>

              {/* 隐藏模型 */}
              <div style="margin-bottom: 1.25rem;">
                <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; font-size: 0.85rem; color: var(--text-secondary);">
                  <input
                    type="checkbox"
                    name="hidden"
                    value="on"
                    checked={isEdit && props.model?.hidden === true}
                    style="width: 16px; height: 16px; accent-color: var(--accent-color);"
                  />
                  <span>隐藏此模型（首页不展示，后台列表排到最后）</span>
                </label>
              </div>

              <div class="form-actions">
                <button type="submit" class="btn btn-primary">{isEdit ? '保存修改' : '添加模型'}</button>
                <a href="/admin/models" class="btn btn-secondary">取消</a>
              </div>
            </form>

            {isEdit && props.model && (
              <div class="limits-section">
                <h2 class="limits-title">使用限制</h2>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                  在独立页面管理模型的使用限制规则
                </p>
                <a
                  href={`/admin/models/${encodeURIComponent(props.model.customModel)}/limits`}
                  class="btn btn-secondary"
                >
                  管理限制规则 →
                </a>
              </div>
            )}
          </div>
        </TopbarNav>
      </body>
    </html>
  );
};
