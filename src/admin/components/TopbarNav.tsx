import { FC, PropsWithChildren } from 'hono/jsx';

interface MenuItem {
  href: string;
  label: string;
}

interface Props extends PropsWithChildren {
  title: string;
  activePath?: string;
  menuItems?: MenuItem[];
}

export const TopbarNav: FC<Props> = (props) => {
  const {
    title,
    activePath = '/admin/models',
    menuItems = [
      { href: '/admin/models', label: '模型' },
      { href: '/admin/users', label: '用户' },
      { href: '/admin/api-keys', label: 'API Keys' },
      { href: '/admin/model-groups', label: '模型组' },
      { href: '/admin/stats', label: '统计' },
      { href: '/admin/password', label: '密码设置' },
      { href: '/admin/privacy', label: '隐私保护' },
    ],
    children,
  } = props;

  return (
    <>
      {/* ───── 顶部导航 ───── */}
      <nav class="topbar">
        <div class="topbar-inner">
          <a href="/admin/models" class="topbar-brand">LLM Gateway</a>
          <ul class="topbar-nav">
            {menuItems.map((item) => (
              <li>
                <a
                  href={item.href}
                  class={activePath === item.href ? 'active' : ''}
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      {/* ───── 主内容区 ───── */}
      <main class="main-content" style="padding: 2.5rem 2rem 4rem; max-width: 1280px; margin: 0 auto; animation: fadeUp 0.6s ease-out both;">
        {children}
      </main>

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
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
          font-family: system-ui, -apple-system, sans-serif;
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
          font-family: system-ui, -apple-system, sans-serif;
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
        }
        .topbar-nav a:hover {
          color: var(--accent-color);
          background: hsl(245 80% 96%);
        }
        .topbar-nav a.active {
          color: var(--accent-color);
          background: hsl(245 80% 94%);
        }

        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @media (max-width: 768px) {
          .topbar-inner {
            flex-direction: column;
            height: auto;
            padding: 0.75rem 1rem;
            gap: 0.5rem;
          }
          .topbar-nav {
            flex-wrap: wrap;
            justify-content: center;
          }
          .main-content {
            padding: 1.5rem 1rem 3rem !important;
          }
        }
      `}</style>
    </>
  );
};
