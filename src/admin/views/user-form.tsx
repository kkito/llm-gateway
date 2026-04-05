import { FC } from 'hono/jsx';
import { TopbarNav } from '../components/TopbarNav.js';

interface UserApiKey {
  name: string;
  apikey: string;
  desc?: string;
}

interface Props {
  mode: 'new' | 'edit';
  user?: UserApiKey;
}

export const UserFormPage: FC<Props> = (props) => {
  const isEdit = props.mode === 'edit';
  const title = isEdit ? '编辑用户' : '新增用户';
  const actionUrl = isEdit ? `/admin/users/edit/${props.user?.name}` : '/admin/users/new';

  return (
    <html lang="zh-CN">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title} - LLM Gateway</title>
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

          .form-card {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: var(--radius);
            padding: 2rem;
            box-shadow: var(--shadow-sm);
          }

          .form-title {
            font-family: 'Outfit', sans-serif;
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

          .form-input {
            width: 100%;
            padding: 0.7rem 0.9rem;
            border: 1.5px solid var(--border-color);
            border-radius: var(--radius-sm);
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

          .form-hint {
            display: block;
            font-size: 0.78rem;
            color: var(--text-secondary);
            margin-top: 0.35rem;
          }

          .apikey-display {
            margin-bottom: 1rem;
            padding: 0.75rem;
            background: var(--bg-page);
            border-radius: var(--radius-sm);
          }

          .apikey-label {
            display: block;
            margin-bottom: 0.5rem;
            font-weight: 600;
          }

          .apikey-code {
            font-size: 0.9rem;
            color: var(--text-secondary);
            font-family: 'DM Mono', monospace;
          }

          .apikey-note {
            font-size: 0.8rem;
            color: var(--text-secondary);
            margin-top: 0.5rem;
          }

          .form-actions {
            display: flex;
            gap: 0.75rem;
            margin-top: 1.5rem;
          }

          .btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
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

          @media (max-width: 768px) {
            .main-content { padding: 1.5rem 1rem 3rem !important; }
            .form-card { padding: 1.5rem; }
          }
        `}</style>
      </head>
      <body>
        <TopbarNav title={title} activePath="/admin/users">
          <div class="form-card">
            <h1 class="form-title">{title}</h1>

            <form method="post" action={actionUrl}>
              <div class="form-group">
                <label class="form-label" for="name">
                  用户名称 *
                  <input
                    class="form-input"
                    type="text"
                    id="name"
                    name="name"
                    value={props.user?.name || ''}
                    required
                    placeholder="请输入用户名称"
                  />
                </label>
              </div>

              <div class="form-group">
                <label class="form-label" for="desc">
                  描述
                  <input
                    class="form-input"
                    type="text"
                    id="desc"
                    name="desc"
                    value={props.user?.desc || ''}
                    placeholder="可选，描述用户用途"
                  />
                </label>
              </div>

              {isEdit && (
                <div class="apikey-display">
                  <label class="apikey-label">API Key</label>
                  <code class="apikey-code">{props.user?.apikey}</code>
                  <p class="apikey-note">
                    API Key 不可修改，如需更换请删除后重新创建
                  </p>
                </div>
              )}

              <div class="form-actions">
                <button type="submit" class="btn btn-primary">
                  {isEdit ? '保存' : '创建'}
                </button>
                <a href="/admin/users" class="btn btn-secondary">取消</a>
              </div>
            </form>
          </div>
        </TopbarNav>
      </body>
    </html>
  );
};
