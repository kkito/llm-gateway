import { FC } from 'hono/jsx';

interface Props {
  error?: string;
  isSetup?: boolean;
}

export const LoginPage: FC<Props> = (props) => {
  const title = props.isSetup ? '设置管理员密码' : '管理员登录';

  return (
    <html lang="zh-CN">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title} - LLM Gateway</title>
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
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 1rem;
          }

          .login-card {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: var(--radius);
            padding: 2.5rem;
            box-shadow: var(--shadow-sm);
            width: 100%;
            max-width: 400px;
          }

          .login-title {
            font-family: system-ui, -apple-system, sans-serif;
            font-weight: 700;
            font-size: 1.5rem;
            margin-bottom: 1.5rem;
            color: var(--text-primary);
            text-align: center;
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
            transition: border-color 0.2s, box-shadow 0.2s;
          }

          .form-input:focus {
            border-color: var(--accent-color);
            box-shadow: 0 0 0 3px hsl(245 80% 58% / 0.12);
            background: var(--bg-card);
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
            width: 100%;
          }

          .btn-primary {
            background: var(--accent-gradient);
            color: #fff;
            box-shadow: 0 4px 14px hsl(245 75% 58% / 0.35);
          }

          .btn-primary:hover {
            box-shadow: 0 6px 20px hsl(245 75% 58% / 0.45);
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

          .alert-warning {
            background: #fffbeb;
            border: 1px solid #fde68a;
            color: #92400e;
          }

          @media (max-width: 480px) {
            .login-card {
              padding: 1.5rem;
            }
          }
        `}</style>
      </head>
      <body>
        <div class="login-card">
          <h1 class="login-title">{title}</h1>

          {props.error && (
            <div class="alert alert-error">
              <strong>错误：</strong> {props.error}
            </div>
          )}

          {props.isSetup && (
            <div class="alert alert-warning">
              <strong>提示：</strong> 首次使用后台管理，请设置管理员密码。删除 config.json 中的 adminPassword 字段可清除密码。
            </div>
          )}

          <form method="post" action="/admin/login">
            <div class="form-group">
              <label htmlFor="password" class="form-label">密码</label>
              <input
                type="password"
                id="password"
                name="password"
                required
                autofocus
                placeholder="请输入密码"
                class="form-input"
              />
            </div>
            <button type="submit" class="btn btn-primary">
              {props.isSetup ? '设置密码' : '登录'}
            </button>
          </form>
        </div>
      </body>
    </html>
  );
};
