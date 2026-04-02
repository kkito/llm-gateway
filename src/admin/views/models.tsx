import { FC } from 'hono/jsx';
import type { ProviderConfig } from '../../config.js';

interface Props {
  models: ProviderConfig[];
  error?: string;
}

export const ModelsPage: FC<Props> = (props) => {
  return (
    <html lang="zh-CN">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>模型管理 - LLM Gateway</title>
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
          .btn-icon {
            width: 32px;
            height: 32px;
            padding: 0;
            justify-content: center;
            border-radius: 50%;
            font-size: 0.85rem;
          }
          .btn-sm {
            padding: 0.45rem 0.85rem;
            font-size: 0.82rem;
          }

          /* Error banner */
          .error-banner {
            background: var(--danger-bg);
            border: 1px solid #fecaca;
            color: var(--danger-color);
            padding: 1rem 1.25rem;
            border-radius: var(--radius-sm);
            margin-bottom: 1.5rem;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            animation: slideDown 0.4s ease-out;
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
          .models-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
            gap: 1.25rem;
            animation: fadeUp 0.6s ease-out both;
          }

          @media (max-width: 480px) {
            .models-grid {
              grid-template-columns: 1fr;
            }
          }

          .model-card {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: var(--radius);
            padding: 1.75rem;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
            overflow: hidden;
            animation: cardReveal 0.5s ease-out both;
          }
          .model-card::before {
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
          .model-card:hover {
            transform: translateY(-5px);
            box-shadow: var(--shadow-lg);
            border-color: transparent;
          }
          .model-card:hover::before {
            opacity: 1;
          }

          /* Card header */
          .model-card-header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 1rem;
            margin-bottom: 1.25rem;
          }
          .model-name-block {
            flex: 1;
          }
          .model-tag {
            display: inline-flex;
            align-items: center;
            gap: 0.35rem;
            background: hsl(245 80% 94%);
            color: var(--accent-color);
            padding: 0.3rem 0.7rem;
            border-radius: 6px;
            font-size: 0.78rem;
            font-weight: 600;
            margin-bottom: 0.6rem;
          }
          .model-tag-icon {
            font-size: 0.7rem;
          }
          .model-custom-name {
            font-family: 'Outfit', sans-serif;
            font-weight: 600;
            font-size: 1.15rem;
            color: var(--text-primary);
            letter-spacing: -0.02em;
          }
          .model-real-name {
            display: block;
            font-size: 0.85rem;
            color: var(--text-secondary);
            margin-top: 0.25rem;
          }
          .model-real-name span {
            color: var(--text-primary);
            font-weight: 500;
          }
          .order-controls {
            display: flex;
            flex-direction: column;
            gap: 0.35rem;
            flex-shrink: 0;
          }
          .order-btn {
            width: 28px;
            height: 28px;
            padding: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            border: 1px solid var(--border-color);
            border-radius: 6px;
            background: var(--bg-card);
            color: var(--text-secondary);
            cursor: pointer;
            font-size: 0.75rem;
            font-weight: 600;
            transition: all 0.2s;
          }
          .order-btn:hover:not(:disabled) {
            border-color: var(--accent-color);
            color: var(--accent-color);
          }
          .order-btn:disabled {
            opacity: 0.3em;
            cursor: not-allowed;
          }

          /* Card body */
          .model-card-body {
            display: flex;
            flex-direction: column;
            gap: 0.6rem;
            margin-bottom: 1.25rem;
          }
          .meta-row {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.88rem;
          }
          .meta-label {
            color: var(--text-secondary);
            min-width: 65px;
            font-weight: 500;
          }
          .meta-value {
            color: var(--text-primary);
            font-family: 'DM Mono', 'Fira Code', monospace;
            font-size: 0.82rem;
            background: #f3f4f6;
            padding: 0.25rem 0.55rem;
            border-radius: 5px;
          }
          .provider-badge {
            display: inline-flex;
            align-items: center;
            gap: 0.3rem;
            font-size: 0.78rem;
            font-weight: 600;
            text-transform: lowercase;
            padding: 0.2rem 0.65rem;
            border-radius: 5px;
          }
          .provider-openai {
            background: #ecfdf5;
            color: #059669;
          }
          .provider-anthropic {
            background: #fef3c7;
            color: #b45309;
          }
          .provider-azure {
            background: #eff6ff;
            color: #1d4ed8;
          }
          .provider-default {
            background: #f3f4f6;
            color: #4b5563;
          }
          .model-desc {
            font-size: 0.85rem;
            color: var(--text-secondary);
            line-height: 1.55;
            padding: 0.75rem;
            background: #fafafa;
            border-radius: var(--radius-sm);
            border-left: 3px solid hsl(245 20% 85%);
          }

          /* Card actions */
          .model-card-actions {
            display: flex;
            gap: 0.5rem;
            padding-top: 1rem;
            border-top: 1px solid var(--border-color);
          }

          .btn-danger {
            background: var(--danger-bg);
            color: var(--danger-color);
            border: 1px solid #fecaca;
          }
          .btn-danger:hover {
            background: var(--danger-color);
            color: #fff;
            border-color: var(--danger-color);
          }

          /* ───── Animations ───── */
          @keyframes fadeUp {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
          }
          @keyframes slideDown {
            from { opacity: 0; transform: translateY(-10px); }
            to { opacity: 1; transform: translateY(0); }
          }
          @keyframes cardReveal {
            from {
              opacity: 0;
              transform: translateY(24px) scale(0.97);
            }
            to {
              opacity: 1;
              transform: translateY(0) scale(1);
            }
          }

          /* Staggered animation delays for cards */
          .model-card:nth-child(1) { animation-delay: 0.05s; }
          .model-card:nth-child(2) { animation-delay: 0.10s; }
          .model-card:nth-child(3) { animation-delay: 0.15s; }
          .model-card:nth-child(4) { animation-delay: 0.20s; }
          .model-card:nth-child(5) { animation-delay: 0.25s; }
          .model-card:nth-child(6) { animation-delay: 0.30s; }
          .model-card:nth-child(7) { animation-delay: 0.35s; }
          .model-card:nth-child(8) { animation-delay: 0.40s; }

          /* ───── Responsive ───── */
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
              padding: 1.5rem 1rem 3rem;
            }
            .page-header {
              flex-direction: column;
              align-items: flex-start;
            }
            .page-title {
              font-size: 1.5rem;
            }
            .model-card {
              padding: 1.25rem;
            }
          }
        `}</style>
        <link rel="stylesheet" href="/assets/pico.min.css" />
      </head>
      <body>

        {/* ───── 顶部导航 ───── */}
        <nav class="topbar">
          <div class="topbar-inner">
            <a href="/user/main" class="topbar-brand">LLM Gateway</a>
            <ul class="topbar-nav">
              <li><a href="/admin/models" class="active">模型管理</a></li>
              <li><a href="/admin/users">用户管理</a></li>
              <li><a href="/admin/stats">统计 Dashboard</a></li>
              <li><a href="/admin/password">密码设置</a></li>
              <li><a href="/admin/api-keys">API Key 管理</a></li>
            </ul>
          </div>
        </nav>

        <main class="main-content">

          {/* ───── 页面标题区 ───── */}
          <div class="page-header">
            <div>
              <h1 class="page-title">模型管理</h1>
              <p class="page-subtitle">配置和管理所有上游模型信息，调整顺序及增减模型。</p>
            </div>
            <div class="btn-group">
              <a href="/admin/model-groups" class="btn btn-secondary">Model Groups</a>
              <a href="/admin/models/new" class="btn btn-primary">+ 新增模型</a>
            </div>
          </div>

          {props.error && (
            <div class="error-banner">
              <strong>错误：</strong> {props.error}
            </div>
          )}

          {props.models.length === 0 ? (
            <div class="empty-state">
              <div class="empty-state-icon">⚙</div>
              <h3>暂无模型配置</h3>
              <p>点击 "新增模型" 添加你的第一个模型。</p>
              <a href="/admin/models/new" class="btn btn-primary">新增模型</a>
            </div>
          ) : (
            <div class="models-grid">
              {props.models.map((model, index) => (
                <div class="model-card">
                  <div class="model-card-header">
                    <div class="model-name-block">
                      <span class="model-tag">
                        <span class="model-tag-icon">⚡</span> 模型 #{index + 1}
                      </span>
                      <span class="model-custom-name">{model.customModel}</span>
                      <span class="model-real-name">真实模型: <span>{model.realModel}</span></span>
                    </div>
                    <div class="order-controls">
                      <button
                        type="button"
                        class="order-btn"
                        data-move-url={`/admin/models/move/${model.customModel}`}
                        data-direction="up"
                        disabled={index === 0}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        class="order-btn"
                        data-move-url={`/admin/models/move/${model.customModel}`}
                        data-direction="down"
                        disabled={index === props.models.length - 1}
                      >
                        ↓
                      </button>
                    </div>
                  </div>

                  <div class="model-card-body">
                    <div class="meta-row">
                      <span class="meta-label">Provider</span>
                      <span
                        class={`provider-badge ${
                          model.provider === 'openai'
                            ? 'provider-openai'
                            : model.provider === 'anthropic'
                            ? 'provider-anthropic'
                            : model.provider === 'azure'
                            ? 'provider-azure'
                            : 'provider-default'
                        }`}
                      >
                        {model.provider}
                      </span>
                    </div>
                    <div class="meta-row">
                      <span class="meta-label">Base URL</span>
                      <span class="meta-value">{model.baseUrl}</span>
                    </div>
                    {model.desc && (
                      <div class="model-desc">
                        {model.desc}
                      </div>
                    )}
                  </div>

                  <div class="model-card-actions">
                    <a
                      href={`/admin/models/edit/${model.customModel}`}
                      class="btn btn-secondary btn-sm"
                    >
                      编辑
                    </a>
                    <a
                      href={`/admin/models/${encodeURIComponent(model.customModel)}/limits`}
                      class="btn btn-secondary btn-sm"
                    >
                      管理限制
                    </a>
                    <button
                      type="button"
                      class="btn btn-sm btn-danger"
                      data-delete-url={`/admin/models/delete/${model.customModel}`}
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

        </main>

        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                // 删除功能
                document.querySelectorAll('button[data-delete-url]').forEach(function(btn) {
                  btn.addEventListener('click', function() {
                    var url = this.getAttribute('data-delete-url');
                    var modelName = url.split('/').pop();
                    if (confirm('确定要删除模型 "' + modelName + '" 吗？')) {
                      var form = document.createElement('form');
                      form.method = 'POST';
                      form.action = url;
                      document.body.appendChild(form);
                      form.submit();
                    }
                  });
                });

                // 移动顺序功能
                document.querySelectorAll('button[data-move-url]').forEach(function(btn) {
                  btn.addEventListener('click', function() {
                    var url = this.getAttribute('data-move-url');
                    var direction = this.getAttribute('data-direction');
                    var form = document.createElement('form');
                    form.method = 'POST';
                    form.action = url + '?direction=' + direction;
                    document.body.appendChild(form);
                    form.submit();
                  });
                });
              })();
            `
          }}
        />

      </body>
    </html>
  );
};
