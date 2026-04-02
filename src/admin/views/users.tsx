import { FC } from 'hono/jsx';

export interface UserApiKey {
  name: string;
  apikey: string;
  desc?: string;
}

interface Props {
  users: UserApiKey[];
  error?: string;
  authEnabled?: boolean;
}

export const UsersPage: FC<Props> = (props) => {
  const authEnabled = props.authEnabled !== false;
  const hasUsers = props.users.length > 0;

  return (
    <html lang="zh-CN">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>用户管理 - LLM Gateway</title>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=DM+Sans:wght@400;500;600&display=swap');

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

          /* ───── 顶部导航 ───── */
          .topbar {
            background: var(--bg-card);
            border-bottom: 1px solid var(--border-color);
            position: sticky;
            top: 0;
            z-index: 100;
            backdrop-filter: blur(12px);
            background: rgba(255,255,255,0.88);
          }
          .topbar-inner {
            max-width: 1280px;
            margin: 0 auto;
            padding: 0 2rem;
            display: flex;
            align-items: center;
            justify-content: space-between;
            height: 64px;
          }
          .topbar-brand {
            font-family: 'Outfit', sans-serif;
            font-weight: 700;
            font-size: 1.2rem;
            background: var(--accent-gradient);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            text-decoration: none;
            letter-spacing: -0.02em;
          }
          .topbar-nav {
            display: flex;
            gap: 0.25rem;
            list-style: none;
          }
          .topbar-nav a {
            text-decoration: none;
            color: var(--text-secondary);
            font-weight: 500;
            font-size: 0.9rem;
            padding: 0.5rem 0.85rem;
            border-radius: 8px;
            transition: all 0.2s ease;
          }
          .topbar-nav a:hover {
            color: var(--accent-color);
            background: hsl(245 80% 96%);
          }
          .topbar-nav a.active {
            color: var(--accent-color);
            background: hsl(245 80% 94%);
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
            font-size: 1.85rem;
            letter-spacing: -0.03em;
            color: var(--text-primary);
          }
          .page-subtitle {
            color: var(--text-secondary);
            font-size: 0.95rem;
            margin-top: 0.3rem;
          }
          .btn-group {
            display: flex;
            gap: 0.75rem;
            flex-wrap: wrap;
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
            width: 32px;
            height: 32px;
            padding: 0;
            justify-content: center;
            border-radius: 50%;
            font-size: 0.85rem;
          }
          .btn-danger {
            background: var(--danger-color);
            color: #fff;
          }
          .btn-danger:hover {
            background: #dc2626;
          }

          /* Error banner */
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

          /* Auth status banner */
          .auth-banner {
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
          }
          .auth-banner--disabled {
            background: var(--danger-bg);
            border-color: #fecaca;
            color: var(--danger-color);
          }

          /* Empty state */
          .empty-state {
            text-align: center;
            padding: 4rem 2rem;
            background: var(--bg-card);
            border-radius: var(--radius);
            border: 1px dashed var(--border-color);
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

          /* ───── 卡片网格 ───── */
          .users-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
            gap: 1.25rem;
            animation: fadeUp 0.6s ease-out both;
          }

          @media (max-width: 480px) {
            .users-grid {
              grid-template-columns: 1fr;
            }
          }

          .user-card {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: var(--radius);
            padding: 1.75rem;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
            overflow: hidden;
            animation: cardReveal 0.5s ease-out both;
          }
          .user-card::before {
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
          .user-card:hover {
            transform: translateY(-5px);
            box-shadow: var(--shadow-lg);
            border-color: transparent;
          }
          .user-card:hover::before {
            opacity: 1;
          }

          @keyframes cardReveal {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
          }

          /* Card header */
          .user-card-header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 1rem;
            margin-bottom: 1.25rem;
          }
          .user-info {
            flex: 1;
          }
          .user-avatar {
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
          .user-name {
            font-family: 'Outfit', sans-serif;
            font-weight: 600;
            font-size: 1.15rem;
            color: var(--text-primary);
            letter-spacing: -0.02em;
          }
          .user-actions {
            display: flex;
            gap: 0.4rem;
            flex-shrink: 0;
          }

          /* API Key row */
          .user-apikey-row {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            background: var(--bg-page);
            border: 1px solid var(--border-color);
            border-radius: var(--radius-sm);
            padding: 0.65rem 0.85rem;
            position: relative;
          }
          .user-apikey-label {
            font-size: 0.78rem;
            font-weight: 600;
            color: var(--text-secondary);
            flex-shrink: 0;
          }
          .user-apikey-value {
            flex: 1;
            font-family: 'DM Mono', 'Fira Code', monospace;
            font-size: 0.82rem;
            color: var(--text-primary);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .user-apikey-copy {
            width: 24px;
            height: 24px;
            padding: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            border: none;
            background: transparent;
            color: var(--text-secondary);
            cursor: pointer;
            border-radius: 4px;
            transition: all 0.15s ease;
            font-size: 0.75rem;
          }
          .user-apikey-copy:hover {
            background: var(--border-color);
            color: var(--accent-color);
          }

          /* Description */
          .user-desc {
            margin-top: 0.85rem;
            font-size: 0.85rem;
            color: var(--text-secondary);
            line-height: 1.5;
          }

          /* Action buttons row */
          .user-card-actions {
            display: flex;
            gap: 0.5rem;
            margin-top: 1rem;
            padding-top: 1rem;
            border-top: 1px solid var(--border-color);
          }
          .user-card-actions .btn {
            flex: 1;
            justify-content: center;
          }

          /* Toggle form inline */
          .toggle-form-inline {
            display: inline;
          }
          .toggle-form-inline button {
            transition: all 0.25s ease;
          }

          /* Hint text */
          .hint-text {
            color: var(--text-secondary);
            font-size: 0.82rem;
            margin-top: 0.5rem;
          }

          @media (max-width: 768px) {
            .topbar-inner { padding: 0 1rem; }
            .main-content { padding: 1.5rem 1rem 3rem; }
            .page-title { font-size: 1.5rem; }
            .page-header { flex-direction: column; align-items: flex-start; }
          }
        `}</style>
      </head>
      <body>
        {/* ───── 顶部导航 ───── */}
        <nav class="topbar">
          <div class="topbar-inner">
            <a href="/admin/models" class="topbar-brand">LLM Gateway</a>
            <ul class="topbar-nav">
              <li><a href="/admin/models">模型</a></li>
              <li><a href="/admin/users" class="active">用户</a></li>
              <li><a href="/admin/api-keys">API Keys</a></li>
              <li><a href="/admin/stats">统计</a></li>
            </ul>
          </div>
        </nav>

        {/* ───── 主内容 ───── */}
        <div class="main-content">
          {/* 页头 */}
          <div class="page-header">
            <div>
              <h1 class="page-title">用户管理</h1>
              <p class="page-subtitle">管理访问 API 的用户和密钥</p>
            </div>
            <div class="btn-group">
              <a href="/admin/users/new" class="btn btn-primary">
                <span>➕</span> 新增用户
              </a>

              {/* 启用/禁用切换按钮 */}
              <form method="post" action="/admin/users/toggle" class="toggle-form-inline">
                <input type="hidden" name="enabled" value={authEnabled ? 'false' : 'true'} />
                <button
                  type="submit"
                  class={`btn ${authEnabled ? 'btn-secondary' : 'btn-primary'}`}
                  style={{
                    backgroundColor: !authEnabled ? 'var(--danger-color)' : undefined,
                    color: !authEnabled ? '#fff' : undefined,
                    borderColor: authEnabled ? undefined : 'transparent'
                  }}
                  onclick={!authEnabled && !hasUsers ? 'return false;' : undefined}
                >
                  {authEnabled ? '🔓 禁用认证' : '🔒 启用认证'}
                </button>
              </form>
            </div>
          </div>

          {/* 认证状态提示 */}
          <div class={`auth-banner ${!authEnabled ? 'auth-banner--disabled' : ''}`}>
            {authEnabled ? '✅ 用户认证已启用' : '⚠️ 用户认证已禁用，所有用户均可直接访问'}
            {!authEnabled && !hasUsers && (
              <span style="margin-left: 0.5rem; font-size: 0.85rem;">
                （请先添加用户后再启用）
              </span>
            )}
          </div>

          {/* 错误提示 */}
          {props.error && (
            <div class="error-banner">
              <span>❌</span> {props.error}
            </div>
          )}

          {/* 用户列表 */}
          {props.users.length === 0 ? (
            <div class="empty-state">
              <div class="empty-state-icon">👤</div>
              <h3>暂无用户</h3>
              <p>
                {authEnabled
                  ? '点击"新增用户"添加第一个用户'
                  : '用户认证已禁用'}
              </p>
              <a href="/admin/users/new" class="btn btn-primary">
                <span>➕</span> 新增用户
              </a>
            </div>
          ) : (
            <div class="users-grid">
              {props.users.map((user, idx) => (
                <div
                  class="user-card"
                  style={`animation-delay: ${idx * 0.1}s`}
                >
                  <div class="user-card-header">
                    <div class="user-info">
                      <div style="display: flex; align-items: center; gap: 0.85rem;">
                        <div class="user-avatar">👤</div>
                        <div>
                          <div class="user-name">{user.name}</div>
                          <div style="font-size: 0.82rem; color: var(--text-secondary);">
                            用户
                          </div>
                        </div>
                      </div>
                    </div>
                    <div class="user-actions">
                      <a
                        href={`/admin/users/edit/${user.name}`}
                        class="btn btn-icon btn-secondary"
                        title="编辑"
                      >
                        ✏️
                      </a>
                    </div>
                  </div>

                  {/* API Key 行 */}
                  <div class="user-apikey-row">
                    <span class="user-apikey-label">Key</span>
                    <code class="user-apikey-value" title={`sk-${user.apikey}`}>
                      sk-<span dangerouslySetInnerHTML={{__html: user.apikey}} />
                    </code>
                    <button
                      class="user-apikey-copy"
                      title="复制 Key"
                      onclick={`navigator.clipboard.writeText('sk-${user.apikey}'); this.textContent = '✓'; setTimeout(() => this.textContent = '📋', 1500);`}
                    >
                      📋
                    </button>
                  </div>

                  {/* 描述 */}
                  {user.desc && (
                    <div class="user-desc">{user.desc}</div>
                  )}

                  {/* 操作按钮 */}
                  <div class="user-card-actions">
                    <a
                      href={`/admin/users/edit/${user.name}`}
                      class="btn btn-secondary btn-sm"
                    >
                      ✏️ 编辑
                    </a>
                    <button
                      type="button"
                      class="btn btn-sm"
                      style="background: var(--danger-bg); color: var(--danger-color);"
                      onclick={`if (confirm('确定要删除用户 "${user.name}" 吗？')) { var form = document.createElement('form'); form.method = 'POST'; form.action = '/admin/users/delete/${user.name}'; document.body.appendChild(form); form.submit(); }`}
                    >
                      🗑️ 删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </body>
    </html>
  );
};