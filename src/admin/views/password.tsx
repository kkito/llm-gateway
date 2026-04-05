import { FC } from 'hono/jsx';
import { TopbarNav } from '../components/TopbarNav.js';

interface Props {
  error?: string;
  success?: string;
  hasPassword: boolean;
}

export const PasswordPage: FC<Props> = (props) => {
  return (
    <html lang="zh-CN">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>修改密码 - LLM Gateway</title>
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

          .btn-danger {
            background: #fef2f2;
            color: #ef4444;
            border: 1px solid #fecaca;
          }

          .btn-danger:hover {
            background: #ef4444;
            color: #fff;
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

          .alert-warning {
            background: #fffbeb;
            border: 1px solid #fde68a;
            color: #92400e;
          }

          .alert-info {
            background: #eff6ff;
            border: 1px solid #bfdbfe;
            color: #1e40af;
          }

          @media (max-width: 768px) {
            .main-content { padding: 1.5rem 1rem 3rem !important; }
            .form-card { padding: 1.5rem; }
          }
        `}</style>
      </head>
      <body>
        <TopbarNav title="修改密码" activePath="/admin/password">
          <div class="form-card">
            <h1 class="form-title">修改密码</h1>

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

            {!props.hasPassword ? (
              <div class="alert alert-warning">
                <strong>提示：</strong> 当前未设置密码。下方设置新密码后，访问后台需要输入密码。
                <br />
                如需取消密码保护，请删除 config.json 中的 adminPassword 字段。
              </div>
            ) : (
              <div class="alert alert-info">
                <strong>提示：</strong> 当前已设置密码保护。可以修改或删除密码。
              </div>
            )}

            <form method="post" action="/admin/password">
              {props.hasPassword && (
                <div class="form-group">
                  <label class="form-label" for="currentPassword">
                    当前密码
                    <input
                      class="form-input"
                      type="password"
                      id="currentPassword"
                      name="currentPassword"
                      required
                      placeholder="请输入当前密码"
                    />
                  </label>
                </div>
              )}

              <div class="form-group">
                <label class="form-label" for="newPassword">
                  新密码
                  <input
                    class="form-input"
                    type="password"
                    id="newPassword"
                    name="newPassword"
                    placeholder="请输入新密码"
                  />
                </label>
              </div>

              <div class="form-group">
                <label class="form-label" for="confirmPassword">
                  确认新密码
                  <input
                    class="form-input"
                    type="password"
                    id="confirmPassword"
                    name="confirmPassword"
                    placeholder="请再次输入新密码"
                  />
                </label>
              </div>

              <div class="form-actions">
                <button type="submit" name="action" value="change" class="btn btn-primary">
                  {props.hasPassword ? '修改密码' : '设置密码'}
                </button>

                {props.hasPassword && (
                  <button
                    type="submit"
                    name="action"
                    value="delete"
                    class="btn btn-danger"
                    onclick="return confirm('确定要删除密码保护吗？删除后访问后台将不需要密码。')"
                  >
                    删除密码
                  </button>
                )}
              </div>
            </form>
          </div>
        </TopbarNav>
      </body>
    </html>
  );
};
