import { FC } from 'hono/jsx';

interface Props {
  error?: string;
}

export const LoginPage: FC<Props> = (props) => {
  return (
    <html>
      <head>
        <title>登录 - LLM Gateway</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style
          dangerouslySetInnerHTML={{
            __html: `
              :root {
                --primary: #6366f1;
                --primary-hover: #4f46e5;
                --error: #dc2626;
                --error-bg: #fef2f2;
                --success: #10b981;
                --success-bg: #d1fae5;
                --card-bg: #ffffff;
                --text-primary: #1f2937;
                --text-secondary: #6b7280;
                --border: #e5e7eb;
                --bg: #f8fafc;
                --radius: 12px;
                --radius-sm: 8px;
                --shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
                --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
              }

              * {
                box-sizing: border-box;
                margin: 0;
                padding: 0;
              }

              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                background: linear-gradient(135deg, #f8fafc 0%, #eef2ff 100%);
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 1rem;
              }

              .login-container {
                background: var(--card-bg);
                border-radius: var(--radius);
                box-shadow: var(--shadow-lg);
                padding: 2rem;
                width: 100%;
                max-width: 420px;
              }

              .login-header {
                text-align: center;
                margin-bottom: 1.5rem;
              }

              .login-header h1 {
                font-size: 1.5rem;
                font-weight: 700;
                color: var(--text-primary);
                margin-bottom: 0.5rem;
                background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
              }

              .login-header p {
                font-size: 0.875rem;
                color: var(--text-secondary);
              }

              .error-message {
                background: var(--error-bg);
                color: var(--error);
                padding: 0.75rem 1rem;
                border-radius: var(--radius-sm);
                font-size: 0.875rem;
                margin-bottom: 1rem;
                border: 1px solid #fecaca;
              }

              .form-group {
                margin-bottom: 1.25rem;
              }

              .form-group label {
                display: block;
                font-size: 0.875rem;
                font-weight: 500;
                color: var(--text-primary);
                margin-bottom: 0.5rem;
              }

              .form-group input {
                width: 100%;
                padding: 0.75rem 1rem;
                font-size: 0.875rem;
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
                transition: border-color 0.2s ease, box-shadow 0.2s ease;
              }

              .form-group input:focus {
                outline: none;
                border-color: var(--primary);
                box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
              }

              .submit-btn {
                width: 100%;
                padding: 0.75rem 1rem;
                font-size: 0.875rem;
                font-weight: 600;
                color: white;
                background: linear-gradient(135deg, var(--primary) 0%, var(--primary-hover) 100%);
                border: none;
                border-radius: var(--radius-sm);
                cursor: pointer;
                transition: all 0.2s ease;
              }

              .submit-btn:hover {
                transform: translateY(-1px);
                box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
              }

              .submit-btn:active {
                transform: translateY(0);
              }

              .login-footer {
                margin-top: 1.5rem;
                text-align: center;
                font-size: 0.75rem;
                color: var(--text-secondary);
              }

              .login-footer a {
                color: var(--primary);
                text-decoration: none;
              }

              .login-footer a:hover {
                text-decoration: underline;
              }
            `
          }}
        />
      </head>
      <body>
        <div class="login-container">
          <div class="login-header">
            <h1>🔑 用户登录</h1>
            <p>请输入您的 API Key 进行登录</p>
          </div>

          {props.error && (
            <div class="error-message">
              ⚠️ {props.error}
            </div>
          )}

          <form method="post" action="/user/login">
            <div class="form-group">
              <label for="apikey">API Key</label>
              <input
                type="password"
                id="apikey"
                name="apikey"
                placeholder="请输入您的 API Key"
                required
                autocomplete="off"
              />
            </div>

            <button type="submit" class="submit-btn">
              登录
            </button>
          </form>

          <div class="login-footer">
            <p>需要 API Key？请联系管理员获取</p>
          </div>
        </div>
      </body>
    </html>
  );
};
