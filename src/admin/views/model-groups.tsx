import { FC } from 'hono/jsx';
import { TopbarNav } from '../components/TopbarNav.js';
import type { ModelGroup } from '../../config.js';

interface Props {
  modelGroups: ModelGroup[];
  error?: string;
  success?: string;
}

export const ModelGroupsPage: FC<Props> = (props) => {
  return (
    <html lang="zh-CN">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Model Groups - LLM Gateway</title>
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
          .groups-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
            gap: 1.25rem;
            animation: fadeUp 0.6s ease-out both;
          }

          @media (max-width: 480px) {
            .groups-grid {
              grid-template-columns: 1fr;
            }
          }

          .group-card {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: var(--radius);
            padding: 1.75rem;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
            overflow: hidden;
            animation: cardReveal 0.5s ease-out both;
          }
          .group-card::before {
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
          .group-card:hover {
            transform: translateY(-5px);
            box-shadow: var(--shadow-lg);
            border-color: transparent;
          }
          .group-card:hover::before {
            opacity: 1;
          }

          @keyframes cardReveal {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
          }

          /* Card header */
          .group-card-header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 1rem;
            margin-bottom: 1rem;
          }
          .group-info {
            flex: 1;
          }
          .group-icon {
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
          .group-name {
            font-family: 'Outfit', sans-serif;
            font-weight: 600;
            font-size: 1.15rem;
            color: var(--text-primary);
            letter-spacing: -0.02em;
          }
          .group-models-count {
            display: inline-flex;
            align-items: center;
            gap: 0.35rem;
            background: var(--success-bg);
            color: var(--success-color);
            padding: 0.3rem 0.7rem;
            border-radius: 6px;
            font-size: 0.78rem;
            font-weight: 600;
            margin-top: 0.5rem;
          }
          .group-actions {
            display: flex;
            gap: 0.4rem;
            flex-shrink: 0;
          }

          /* Description */
          .group-desc {
            margin-top: 0.85rem;
            font-size: 0.85rem;
            color: var(--text-secondary);
            line-height: 1.5;
            padding-top: 0.85rem;
            border-top: 1px solid var(--border-color);
          }

          /* Action buttons row */
          .group-card-actions {
            display: flex;
            gap: 0.5rem;
            margin-top: 1rem;
            padding-top: 1rem;
            border-top: 1px solid var(--border-color);
          }
          .group-card-actions .btn {
            flex: 1;
            justify-content: center;
          }
          .btn-delete {
            background: var(--danger-bg);
            color: var(--danger-color);
          }
          .btn-delete:hover {
            background: var(--danger-color);
            color: #fff;
          }

          /* Models list in card */
          .models-list {
            margin-top: 0.85rem;
            display: flex;
            flex-wrap: wrap;
            gap: 0.4rem;
          }
          .model-tag {
            display: inline-flex;
            align-items: center;
            gap: 0.35rem;
            background: var(--bg-page);
            border: 1px solid var(--border-color);
            color: var(--text-secondary);
            padding: 0.25rem 0.6rem;
            border-radius: 5px;
            font-size: 0.75rem;
            font-weight: 500;
          }

          @media (max-width: 768px) {
            .page-title { font-size: 1.5rem; }
            .page-header { flex-direction: column; align-items: flex-start; }
          }
        `}</style>
      </head>
      <body>
        <TopbarNav title="Model Groups" activePath="/admin/model-groups">
          {/* 页头 */}
          <div class="page-header">
            <div>
              <h1 class="page-title">Model Groups</h1>
              <p class="page-subtitle">管理模型分组配置</p>
            </div>
            <div class="btn-group">
              <a href="/admin/models" class="btn btn-secondary">
                <span>←</span> 返回模型管理
              </a>
              <a href="/admin/model-groups/new" class="btn btn-primary">
                <span>➕</span> 新增组
              </a>
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

          {/* 模型组列表 */}
          {props.modelGroups.length === 0 ? (
            <div class="empty-state">
              <div class="empty-state-icon">📦</div>
              <h3>暂无 Model Group</h3>
              <p>点击"新增组"添加第一个模型组</p>
              <a href="/admin/model-groups/new" class="btn btn-primary">
                <span>➕</span> 新增组
              </a>
            </div>
          ) : (
            <div class="groups-grid">
              {props.modelGroups.map((group, idx) => (
                <div
                  class="group-card"
                  style={`animation-delay: ${idx * 0.1}s`}
                >
                  <div class="group-card-header">
                    <div class="group-info">
                      <div style="display: flex; align-items: center; gap: 0.85rem;">
                        <div class="group-icon">📦</div>
                        <div>
                          <div class="group-name">{group.name}</div>
                          <div class="group-models-count">
                            <span>🤖</span> {group.models.length} 个模型
                          </div>
                        </div>
                      </div>
                    </div>
                    <div class="group-actions">
                      <a
                        href={`/admin/model-groups/edit/${encodeURIComponent(group.name)}`}
                        class="btn btn-icon btn-secondary"
                        title="编辑"
                      >
                        ✏️
                      </a>
                    </div>
                  </div>

                  {/* 描述 */}
                  {group.desc && (
                    <div class="group-desc">{group.desc}</div>
                  )}

                  {/* 模型列表 */}
                  {group.models.length > 0 && (
                    <div class="models-list">
                      {group.models.slice(0, 5).map((model) => (
                        <span class="model-tag">{model}</span>
                      ))}
                      {group.models.length > 5 && (
                        <span class="model-tag">+{group.models.length - 5}</span>
                      )}
                    </div>
                  )}

                  {/* 操作按钮 */}
                  <div class="group-card-actions">
                    <a
                      href={`/admin/model-groups/edit/${encodeURIComponent(group.name)}`}
                      class="btn btn-secondary btn-sm"
                    >
                      ✏️ 编辑
                    </a>
                    <button
                      type="button"
                      class="btn btn-sm btn-delete"
                      onclick={`if (confirm('确定要删除 Model Group "${group.name}" 吗？')) { var form = document.createElement('form'); form.method = 'POST'; form.action = '/admin/model-groups/delete/${encodeURIComponent(group.name)}'; document.body.appendChild(form); form.submit(); }`}
                    >
                      🗑️ 删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TopbarNav>
      </body>
    </html>
  );
};