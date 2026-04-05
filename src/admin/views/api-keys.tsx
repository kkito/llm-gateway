import { FC } from 'hono/jsx';
import { TopbarNav } from '../components/TopbarNav.js';
import type { ApiKey } from '../../config.js';

interface Props {
  apiKeys: Omit<ApiKey, 'key'>[];
  error?: string;
  success?: string;
  editingKey?: Omit<ApiKey, 'key'>;
}

export const ApiKeysPage: FC<Props> = (props) => {
  const isEditing = !!props.editingKey;

  return (
    <html lang="zh-CN">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>API Key 管理 - LLM Gateway</title>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=DM+Sans:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap');

          :root {
            --bg-page: #f8f9fb;
            --bg-card: #ffffff;
            --text-primary: #1a1d26;
            --text-secondary: #646a7e;
            --accent-gradient: linear-gradient(135deg, hsl(245 80% 58%) 0%, hsl(268 75% 58%) 100%);
            --accent-color: hsl(245 80% 58%);
            --danger-color: #ef4444;
            --danger-bg: #fef2f2;
            --success-color: #10b981;
            --success-bg: #f0fdf4;
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
            font-size: 1.85rem;
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
          .btn-sm {
            padding: 0.45rem 0.85rem;
            font-size: 0.82rem;
          }
          .btn-icon {
            width: 36px;
            height: 36px;
            padding: 0;
            justify-content: center;
            border-radius: 50%;
            font-size: 0.85rem;
          }

          /* Banner */
          .success-banner {
            background: var(--success-bg);
            border: 1px solid #bbf7d0;
            color: #166534;
            padding: 0.85rem 1.15rem;
            border-radius: var(--radius-sm);
            margin-bottom: 1.5rem;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            animation: slideDown 0.4s ease-out;
          }
          .error-banner {
            background: var(--danger-bg);
            border: 1px solid #fecaca;
            color: var(--danger-color);
            padding: 0.85rem 1.15rem;
            border-radius: var(--radius-sm);
            margin-bottom: 1.5rem;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            animation: slideDown 0.4s ease-out;
          }

          @keyframes slideDown {
            from { opacity: 0; transform: translateY(-12px); }
            to { opacity: 1; transform: translateY(0); }
          }

          /* Empty state */
          .empty-state {
            text-align: center;
            padding: 4rem 2rem;
            background: var(--bg-card);
            border-radius: var(--radius);
            border: 1px dashed var(--border-color);
            margin-bottom: 2rem;
          }
          .empty-state-icon {
            width: 72px;
            height: 72px;
            margin: 0 auto 1.5rem;
            border-radius: 50%;
            background: hsl(245 80% 94%);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.8rem;
            color: var(--accent-color);
          }
          .empty-state h3 {
            font-family: 'Outfit', sans-serif;
            font-size: 1.2rem;
            margin-bottom: 0.5rem;
          }
          .empty-state p {
            color: var(--text-secondary);
            margin-bottom: 1.5rem;
          }

          /* Two Column Layout */
          .two-col {
            display: grid;
            grid-template-columns: 1fr 380px;
            gap: 2rem;
            animation: fadeUp 0.6s ease-out both;
          }

          @media (max-width: 900px) {
            .two-col {
              grid-template-columns: 1fr;
            }
          }

          /* Keys List */
          .keys-section {
            animation: fadeUp 0.6s ease-out both;
            animation-delay: 0.1s;
            animation-fill-mode: both;
          }
          .keys-section-title {
            font-family: 'Outfit', sans-serif;
            font-weight: 700;
            font-size: 1.15rem;
            margin-bottom: 1.25rem;
            color: var(--text-primary);
          }
          .keys-list {
            display: flex;
            flex-direction: column;
            gap: 1rem;
          }
          .key-card {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: var(--radius);
            padding: 1.5rem;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
            overflow: hidden;
            animation: cardReveal 0.5s ease-out both;
          }
          .key-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 3px;
            background: var(--accent-gradient);
            opacity: 0;
            transition: opacity 0.3s ease;
          }
          .key-card:hover {
            transform: translateY(-3px);
            box-shadow: var(--shadow-lg);
            border-color: transparent;
          }
          .key-card:hover::before {
            opacity: 1;
          }

          @keyframes cardReveal {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
          }

          .key-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 0.75rem;
          }
          .key-icon {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: hsl(245 80% 94%);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.1rem;
            color: var(--accent-color);
            flex-shrink: 0;
          }
          .key-name-block {
            flex: 1;
            margin-left: 0.85rem;
          }
          .key-name {
            font-family: 'Outfit', sans-serif;
            font-weight: 600;
            font-size: 1.05rem;
            color: var(--text-primary);
          }
          .key-date {
            font-size: 0.82rem;
            color: var(--text-secondary);
            margin-top: 0.15rem;
          }
          .key-actions {
            display: flex;
            gap: 0.4rem;
          }
          .key-delete-form {
            display: inline;
          }
          .key-delete-btn {
            width: 36px;
            height: 36px;
            padding: 0;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            background: var(--danger-bg);
            color: var(--danger-color);
            border: none;
            cursor: pointer;
            transition: all 0.2s ease;
            font-size: 0.85rem;
          }
          .key-delete-btn:hover {
            background: var(--danger-color);
            color: #fff;
          }

          /* Form Card */
          .form-card {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: var(--radius);
            padding: 2rem;
            box-shadow: var(--shadow-sm);
            animation: fadeUp 0.6s ease-out both;
            animation-delay: 0.2s;
            animation-fill-mode: both;
          }
          .form-title {
            font-family: 'Outfit', sans-serif;
            font-weight: 700;
            font-size: 1.25rem;
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
          .form-input {
            width: 100%;
            padding: 0.7rem 0.9rem;
            border: 1.5px solid var(--border-color);
            border-radius: var(--radius-sm);
            transition: all 0.2s ease;
            font-size: 0.92rem;
            background: var(--bg-page);
            font-family: inherit;
            outline: none;
          }
          .form-input:focus {
            border-color: var(--accent-color);
            box-shadow: 0 0 0 3px hsl(245 80% 58% / 0.12);
            background: var(--bg-card);
          }
          .form-input::placeholder {
            color: #a0a4b8;
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
            margin-top: 0.5rem;
          }
          .form-actions .btn {
            flex: 1;
            justify-content: center;
          }

          @media (max-width: 768px) {
            .main-content { padding: 1.5rem 1rem 3rem !important; }
            .page-title { font-size: 1.5rem; }
            .page-header { flex-direction: column; align-items: flex-start; }
          }
        `}</style>
      </head>
      <body>
        <TopbarNav title="API Key 管理" activePath="/admin/api-keys">
          {/* 页头 */}
          <div class="page-header">
            <div>
              <h1 class="page-title">API Key 管理</h1>
              <p class="page-subtitle">管理外部调用使用的 API Key</p>
            </div>
          </div>

          {/* 提示 */}
          {props.error && (
            <div class="error-banner">
              <span>❌</span> {props.error}
            </div>
          )}

          {props.success && (
            <div class="success-banner">
              <span>✅</span> {props.success}
            </div>
          )}

          {/* 两列布局 */}
          <div class="two-col">
            {/* 左：Key 列表 */}
            <div class="keys-section">
              <h2 class="keys-section-title">🔑 已存储的 API Key</h2>
              {props.apiKeys.length === 0 ? (
                <div class="empty-state">
                  <div class="empty-state-icon">🔑</div>
                  <h3>暂无 API Key</h3>
                  <p>在右侧表单中添加第一个 API Key</p>
                </div>
              ) : (
                <div class="keys-list">
                  {props.apiKeys.map((key, idx) => (
                    <div
                      class="key-card"
                      style={`animation-delay: ${idx * 0.1}s`}
                    >
                      <div class="key-header">
                        <div style="display: flex; align-items: center;">
                          <div class="key-icon">🔑</div>
                          <div class="key-name-block">
                            <div class="key-name">{key.name}</div>
                            <div class="key-date">创建于 {new Date(key.createdAt).toLocaleDateString('zh-CN', {year: 'numeric', month: '2-digit', day: '2-digit'})}</div>
                          </div>
                        </div>
                        <div class="key-actions">
                          <a
                            href={`/admin/api-keys/edit/${key.id}`}
                            class="btn btn-icon btn-secondary"
                            title="编辑"
                          >
                            ✏️
                          </a>
                          <form
                            method="post"
                            action={`/admin/api-keys/delete/${key.id}`}
                            class="key-delete-form"
                          >
                            <button
                              type="submit"
                              class="key-delete-btn"
                              title="删除"
                            >
                              🗑️
                            </button>
                          </form>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 右：表单 */}
            <div class="form-card">
              <h2 class="form-title">{isEditing ? '✏️ 编辑 API Key' : '➕ 新增 API Key'}</h2>
              <form method="post" action={isEditing ? `/admin/api-keys/edit/${props.editingKey!.id}` : '/admin/api-keys'}>
                <div class="form-group">
                  <label class="form-label" for="name">名称</label>
                  <input
                    class="form-input"
                    id="name"
                    name="name"
                    type="text"
                    placeholder="例如：我的 API Key"
                    value={props.editingKey?.name || ''}
                    required
                  />
                  <span class="form-hint">用于识别此 API Key</span>
                </div>

                <div class="form-group">
                  <label class="form-label" for="key">API Key</label>
                  <input
                    class="form-input"
                    id="key"
                    name="key"
                    type="password"
                    placeholder={isEditing ? '留空则保持原密钥不变' : '请输入 API Key'}
                    required={!isEditing}
                  />
                  {isEditing && <span class="form-hint">留空则保持原密钥不变</span>}
                </div>

                <div class="form-actions">
                  <button type="submit" class="btn btn-primary">
                    {isEditing ? '💾 保存' : '➕ 添加'}
                  </button>
                  {isEditing && (
                    <a href="/admin/api-keys" class="btn btn-secondary">
                      取消
                    </a>
                  )}
                </div>
              </form>
            </div>
          </div>
        </TopbarNav>
      </body>
    </html>
  );
};
