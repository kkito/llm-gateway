import { FC } from 'hono/jsx';
import { TopbarNav } from '../components/TopbarNav.js';
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
            font-family: system-ui, -apple-system, sans-serif;
            background: var(--bg-page);
            color: var(--text-primary);
            line-height: 1.6;
            min-height: 100vh;
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
            font-family: system-ui, -apple-system, sans-serif;
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
            letter-spacing: -0.01em;
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
            padding: 0.4rem 0.75rem;
            font-size: 0.8rem;
            font-weight: 500;
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
            font-family: system-ui, -apple-system, sans-serif;
            font-size: 1.2rem;
            margin-bottom: 0.5rem;
          }
          .empty-state p {
            color: var(--text-secondary);
            margin-bottom: 1.5rem;
          }

          /* ───── 列表表格 ───── */
          .models-table-wrapper {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: var(--radius);
            overflow: hidden;
            animation: fadeUp 0.6s ease-out both;
          }

          .models-table {
            width: 100%;
            border-collapse: collapse;
          }

          .models-table thead {
            background: #fafbfc;
            border-bottom: 1px solid var(--border-color);
          }

          .models-table th {
            padding: 0.75rem 1rem;
            font-size: 0.78rem;
            font-weight: 600;
            color: var(--text-secondary);
            text-align: left;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            white-space: nowrap;
          }

          .models-table td {
            padding: 0.85rem 1rem;
            font-size: 0.88rem;
            border-bottom: 1px solid #f3f4f6;
            vertical-align: middle;
          }

          .models-table tbody tr:last-child td {
            border-bottom: none;
          }

          .models-table tbody tr {
            transition: background 0.2s ease;
          }

          .models-table tbody tr:hover {
            background: #fafbfc;
          }

          .model-name-cell {
            display: flex;
            flex-direction: column;
            gap: 0.15rem;
          }

          .model-custom-name {
            font-weight: 600;
            font-family: system-ui, -apple-system, sans-serif;
            color: var(--text-primary);
            font-size: 0.92rem;
          }

          .model-real-name {
            font-size: 0.8rem;
            color: var(--text-secondary);
          }

          .model-desc-cell {
            max-width: 280px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: var(--text-secondary);
            font-size: 0.84rem;
          }

          .actions-cell {
            display: flex;
            gap: 0.4rem;
            align-items: center;
            flex-wrap: nowrap;
          }

          .order-btn {
            width: 26px;
            height: 26px;
            padding: 0;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border: 1px solid var(--border-color);
            border-radius: 5px;
            background: var(--bg-card);
            color: var(--text-secondary);
            cursor: pointer;
            font-size: 0.75rem;
            font-weight: 600;
            transition: all 0.2s;
            flex-shrink: 0;
          }

          .order-btn:hover:not(:disabled) {
            border-color: var(--accent-color);
            color: var(--accent-color);
          }

          .order-btn.is-hidden {
            background: #fef3c7;
            border-color: #f59e0b;
            color: #d97706;
          }
          .order-btn.is-hidden:hover {
            background: #f59e0b;
            color: #fff;
          }

          .order-btn:disabled {
            opacity: 0.3;
            cursor: not-allowed;
          }

          .index-badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 24px;
            height: 24px;
            border-radius: 50%;
            background: hsl(245 80% 94%);
            color: var(--accent-color);
            font-size: 0.75rem;
            font-weight: 600;
            flex-shrink: 0;
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

          /* ───── Responsive ───── */
          @media (max-width: 768px) {
            .main-content {
              padding: 1.5rem 1rem 3rem !important;
            }
            .page-header {
              flex-direction: column;
              align-items: flex-start;
            }
            .page-title {
              font-size: 1.5rem;
            }
            .models-table-wrapper {
              overflow-x: auto;
            }
            .models-table {
              min-width: 700px;
            }
          }
        `}</style>
      </head>
      <body>
        <TopbarNav title="模型管理" activePath="/admin/models">
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
            <div class="models-table-wrapper">
              <table class="models-table">
                <thead>
                  <tr>
                    <th style="width: 50px;">#</th>
                    <th>模型名称</th>
                    <th>描述</th>
                    <th style="width: 140px;">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {props.models.map((model, index) => (
                    <tr style={model.hidden ? 'opacity: 0.5; background: #f9fafb;' : ''}>
                      <td>
                        <span class="index-badge">{index + 1}</span>
                      </td>
                      <td>
                        <div class="model-name-cell">
                          <span class="model-custom-name">{model.customModel}</span>
                          <span class="model-real-name">→ {model.realModel}</span>
                        </div>
                      </td>
                      <td class="model-desc-cell">
                        {model.desc || '—'}
                      </td>
                      <td>
                        <div class="actions-cell">
                          <button
                            type="button"
                            class="order-btn"
                            data-move-url={`/admin/models/move/${model.customModel}`}
                            data-direction="up"
                            disabled={index === 0}
                            title="上移"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            class="order-btn"
                            data-move-url={`/admin/models/move/${model.customModel}`}
                            data-direction="down"
                            disabled={index === props.models.length - 1}
                            title="下移"
                          >
                            ↓
                          </button>
                          {/* 隐藏开关 */}
                          <button
                            type="button"
                            class={`order-btn ${model.hidden ? 'is-hidden' : ''}`}
                            data-toggle-url={`/admin/models/toggle-hidden/${model.customModel}`}
                            title={model.hidden ? '取消隐藏' : '隐藏'}
                          >
                            {model.hidden ? '👁' : '👁\u200d🗨'}
                          </button>
                          {/* 复制按钮 */}
                          <button
                            type="button"
                            class="btn btn-secondary btn-sm"
                            data-copy-url={`/admin/models/copy/${model.customModel}`}
                            title="复制"
                          >
                            复制
                          </button>
                          <a
                            href={`/admin/models/edit/${model.customModel}`}
                            class="btn btn-secondary btn-sm"
                            title="编辑"
                          >
                            编辑
                          </a>
                          <a
                            href={`/admin/models/${encodeURIComponent(model.customModel)}/limits`}
                            class="btn btn-secondary btn-sm"
                            title="管理限制"
                          >
                            限制
                          </a>
                          <button
                            type="button"
                            class="btn btn-sm btn-danger"
                            data-delete-url={`/admin/models/delete/${model.customModel}`}
                            title="删除"
                          >
                            ×
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TopbarNav>

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

                // 复制功能
                document.querySelectorAll('button[data-copy-url]').forEach(function(btn) {
                  btn.addEventListener('click', function() {
                    var url = this.getAttribute('data-copy-url');
                    var modelName = url.split('/').pop();
                    if (confirm('确定要复制模型 "' + modelName + '" 吗？\n复制后名称将添加时间戳后缀。')) {
                      var form = document.createElement('form');
                      form.method = 'POST';
                      form.action = url;
                      document.body.appendChild(form);
                      form.submit();
                    }
                  });
                });

                // 切换隐藏状态
                document.querySelectorAll('button[data-toggle-url]').forEach(function(btn) {
                  btn.addEventListener('click', function() {
                    var url = this.getAttribute('data-toggle-url');
                    var form = document.createElement('form');
                    form.method = 'POST';
                    form.action = url;
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
