import { html } from 'hono/html';

interface LoginViewProps {
  error?: string;
}

/**
 * HTML 转义函数，防止 XSS 攻击
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function LoginView(props: LoginViewProps) {
  const escapedError = props.error ? escapeHtml(props.error) : '';
  
  return html`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>用户登录 - LLM Gateway</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
    }
    .container {
      background: white;
      padding: 2rem;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      width: 100%;
      max-width: 400px;
    }
    h1 {
      margin-top: 0;
      color: #333;
      font-size: 1.5rem;
      text-align: center;
    }
    .error {
      background: #fee;
      color: #c00;
      padding: 0.75rem;
      border-radius: 4px;
      margin-bottom: 1rem;
      border: 1px solid #fcc;
    }
    .form-group {
      margin-bottom: 1rem;
    }
    label {
      display: block;
      margin-bottom: 0.5rem;
      color: #555;
      font-weight: 500;
    }
    input[type="password"] {
      width: 100%;
      padding: 0.75rem;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 1rem;
      box-sizing: border-box;
    }
    input[type="password"]:focus {
      outline: none;
      border-color: #007bff;
      box-shadow: 0 0 0 2px rgba(0,123,255,0.25);
    }
    button[type="submit"] {
      width: 100%;
      padding: 0.75rem;
      background: #007bff;
      color: white;
      border: none;
      border-radius: 4px;
      font-size: 1rem;
      cursor: pointer;
      font-weight: 500;
    }
    button[type="submit"]:hover {
      background: #0056b3;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>用户登录</h1>
    ${escapedError ? `<div class="error">${escapedError}</div>` : ''}
    <form method="POST" action="/user/login">
      <div class="form-group">
        <label for="apikey">API Key</label>
        <input type="password" id="apikey" name="apikey" required placeholder="sk-lg-xxxxxxxxxxxxxxx">
      </div>
      <button type="submit">登录</button>
    </form>
  </div>
</body>
</html>
`;
}
