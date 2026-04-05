import { FC, PropsWithChildren } from 'hono/jsx';
import type { UserApiKey } from '../../config.js';

interface Props extends PropsWithChildren {
  title: string;
  currentUser?: UserApiKey | null;
}

export const UserLayout: FC<Props> = (props) => {
  const hasUser = !!props.currentUser;

  return (
    <html lang="zh-CN">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{props.title}</title>
        <link
          rel="stylesheet"
          href="/assets/pico.min.css"
        />
        <style
          dangerouslySetInnerHTML={{
            __html: `
              :root {
                --primary: #6366f1;
                --primary-hover: #4f46e5;
                --text-primary: #1f2937;
                --text-secondary: #6b7280;
                --border: #e5e7eb;
                --bg: #f8fafc;
                --card-bg: #ffffff;
                --radius: 12px;
                --radius-sm: 8px;
                --shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
              }

              * {
                box-sizing: border-box;
              }

              body {
                background: var(--bg);
                min-height: 100vh;
                padding-bottom: 2rem;
              }

              .navbar {
                background: var(--card-bg);
                border-bottom: 1px solid var(--border);
                padding: 0.75rem 1.5rem;
                display: flex;
                justify-content: space-between;
                align-items: center;
                box-shadow: var(--shadow);
              }

              .navbar-brand {
                font-size: 1rem;
                font-weight: 700;
                color: var(--text-primary);
                text-decoration: none;
                background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
              }

              .navbar-menu {
                display: flex;
                gap: 1rem;
                align-items: center;
              }

              .navbar-link {
                font-size: 0.875rem;
                color: var(--text-secondary);
                text-decoration: none;
                padding: 0.5rem 0.75rem;
                border-radius: var(--radius-sm);
              }

              .navbar-link:hover {
                background: #f3f4f6;
                color: var(--text-primary);
              }

              .navbar-link.active {
                background: #eef2ff;
                color: var(--primary);
              }

              .user-info {
                display: flex;
                align-items: center;
                gap: 0.75rem;
                padding-left: 1rem;
                border-left: 1px solid var(--border);
              }

              .user-name {
                font-size: 0.875rem;
                color: var(--text-primary);
                font-weight: 500;
              }

              .logout-btn {
                font-size: 0.75rem;
                color: var(--text-secondary);
                text-decoration: none;
                padding: 0.35rem 0.6rem;
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
              }

              .logout-btn:hover {
                border-color: var(--primary);
                color: var(--primary);
              }

              .container {
                max-width: 1200px;
                margin: 0 auto;
                padding: 1.5rem;
              }

              .main-content {
                margin-top: 1rem;
              }
            `
          }}
        />
      </head>
      <body>
        <nav class="navbar">
          <a href="/user/main" class="navbar-brand">🚀 LLM Gateway</a>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div class="navbar-menu">
              <a href="/user/main" class="navbar-link">首页</a>
              <a href="/user/stats" class="navbar-link">统计</a>
            </div>
            {hasUser ? (
              <div class="user-info">
                <span class="user-name">{props.currentUser!.name}</span>
                <a href="/user/logout" class="logout-btn">退出</a>
              </div>
            ) : (
              <a href="/user/login" class="navbar-link">登录</a>
            )}
          </div>
        </nav>

        <div class="container main-content">
          {props.children}
        </div>
      </body>
    </html>
  );
};

// 保持向后兼容的 Layout 导出
export const Layout: FC<PropsWithChildren<{ title: string }>> = (props) => {
  return (
    <html lang="zh-CN">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{props.title}</title>
        <link
          rel="stylesheet"
          href="/assets/pico.min.css"
        />
      </head>
      <body>
        <main class="container">{props.children}</main>
      </body>
    </html>
  );
};
