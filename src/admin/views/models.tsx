import { FC } from 'hono/jsx';
import { TopbarNav } from '../components/TopbarNav.js';
import { ModelTestModal } from '../components/ModelTestModal.js';
import type { ProviderConfig } from '../../config.js';

interface Props {
  models: ProviderConfig[];
  error?: string;
}

interface TestModalState {
  isOpen: boolean;
  modelConfig: {
    customModel: string;
    realModel: string;
    baseUrl: string;
    provider: string;
    apiKey?: string;
  };
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
            min-width: 26px;
            height: 26px;
            padding: 0 4px;
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
                    <th style="min-width: 280px;">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {props.models.map((model, index) => (
                    <tr style={model.hidden ? { opacity: 0.5, background: '#f9fafb' } : undefined}>
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
                            data-move-url={`/admin/models/move/${encodeURIComponent(model.customModel)}`}
                            data-direction="up"
                            disabled={index === 0}
                            title="上移"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            class="order-btn"
                            data-move-url={`/admin/models/move/${encodeURIComponent(model.customModel)}`}
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
                            data-toggle-url={`/admin/models/toggle-hidden/${encodeURIComponent(model.customModel)}`}
                            title={model.hidden ? '显示' : '隐藏'}
                          >
                            {model.hidden ? '显示' : '隐藏'}
                          </button>
                          {/* 复制按钮 */}
                          <button
                            type="button"
                            class="btn btn-secondary btn-sm"
                            data-copy-url={`/admin/models/copy/${encodeURIComponent(model.customModel)}`}
                            title="复制"
                          >
                            复制
                          </button>
                          <a
                            href={`/admin/models/edit/${encodeURIComponent(model.customModel)}`}
                            class="btn btn-secondary btn-sm"
                            title="编辑"
                          >
                            编辑
                          </a>
                          <button
                            type="button"
                            class="btn btn-secondary btn-sm"
                            data-test-model='{JSON.stringify({ customModel: model.customModel, realModel: model.realModel, baseUrl: model.baseUrl, provider: model.provider, apiKey: model.apiKey })}'
                            title="测试"
                          >
                            ⚡测试
                          </button>
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
                            data-delete-url={`/admin/models/delete/${encodeURIComponent(model.customModel)}`}
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

        {/* Model Test Modal */}
        <ModelTestModal isOpen={false} onClose={() => {}} modelConfig={{ customModel: '', realModel: '', baseUrl: '', provider: '' }} />

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
                    if (confirm('确定要复制模型 "' + modelName + '" 吗？\\n复制后名称将添加时间戳后缀。')) {
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

                // 测试模型功能
                var testModalContainer = null;
                document.querySelectorAll('button[data-test-model]').forEach(function(btn) {
                  btn.addEventListener('click', function() {
                    var configStr = this.getAttribute('data-test-model');
                    if (!configStr) return;

                    var config = JSON.parse(configStr);

                    // Remove existing modal if any
                    var existing = document.getElementById('modelTestModalBackdrop');
                    if (existing) existing.remove();
                    var existingModal = document.getElementById('modelTestModal');
                    if (existingModal) existingModal.remove();

                    // Create modal backdrop and container
                    testModalContainer = document.createElement('div');
                    testModalContainer.innerHTML = '<div id="modelTestModalBackdrop" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:999;" onclick="window.closeModelTestModal()"></div>' +
                      '<div id="modelTestModal" style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--bg-card);border-radius:var(--radius);box-shadow:var(--shadow-lg);z-index:1000;width:90%;max-width:720px;max-height:90vh;overflow-y:auto;">' +
                      '<div style="display:flex;align-items:center;justify-content:space-between;padding:1.25rem 1.5rem;border-bottom:1px solid var(--border-color);">' +
                      '<h2 style="margin:0;font-size:1.2rem;font-weight:700;color:var(--text-primary);">测试模型</h2>' +
                      '<button type="button" style="width:32px;height:32px;border:none;background:transparent;cursor:pointer;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.2rem;color:var(--text-secondary);" onclick="window.closeModelTestModal()" title="关闭">×</button>' +
                      '</div>' +
                      '<div style="padding:1.5rem;">' +
                      '<div style="margin-bottom:1.25rem;padding:1rem;background:var(--bg-page);border-radius:var(--radius-sm);border:1px solid var(--border-color);">' +
                      '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:0.75rem;font-size:0.88rem;">' +
                      '<div><span style="color:var(--text-secondary);display:block;font-size:0.8rem;margin-bottom:0.2rem;">自定义名称</span><span style="font-weight:600;color:var(--text-primary);" id="modalCustomModel">' + escapeHtml(config.customModel) + '</span></div>' +
                      '<div><span style="color:var(--text-secondary);display:block;font-size:0.8rem;margin-bottom:0.2rem;">实际模型</span><span style="font-weight:600;color:var(--text-primary);" id="modalRealModel">' + escapeHtml(config.realModel) + '</span></div>' +
                      '<div><span style="color:var(--text-secondary);display:block;font-size:0.8rem;margin-bottom:0.2rem;">Provider</span><span style="color:var(--text-primary);" id="modalProvider">' + escapeHtml(config.provider) + '</span></div>' +
                      '<div><span style="color:var(--text-secondary);display:block;font-size:0.8rem;margin-bottom:0.2rem;">Base URL</span><span style="color:var(--text-primary);font-size:0.82rem;word-break:break-all;" id="modalBaseUrl">' + escapeHtml(config.baseUrl) + '</span></div>' +
                      '</div></div>' +
                      '<div style="margin-bottom:1.25rem;">' +
                      '<label for="modalTestMessage" style="display:block;font-size:0.88rem;font-weight:600;color:var(--text-primary);margin-bottom:0.5rem;">测试消息</label>' +
                      '<textarea id="modalTestMessage" rows="3" style="width:100%;padding:0.75rem;border:1px solid var(--border-color);border-radius:var(--radius-sm);font-size:0.9rem;font-family:inherit;resize:vertical;background:var(--bg-card);color:var(--text-primary);" placeholder="输入测试消息...">请介绍一下你自己</textarea>' +
                      '</div>' +
                      '<button id="modalTestBtn" type="button" onclick="window.runModelTest()" style="width:100%;padding:0.75rem;border:none;border-radius:var(--radius-sm);background:var(--accent-gradient);color:#fff;font-size:0.95rem;font-weight:600;cursor:pointer;box-shadow:0 4px 14px hsl(245 75% 58% / 0.35);">发送</button>' +
                      '<div id="modalTestLoading" style="display:none;text-align:center;padding:1.5rem 0;color:var(--text-secondary);">' +
                      '<div style="display:inline-block;width:20px;height:20px;border:2px solid var(--border-color);border-top-color:var(--accent-color);border-radius:50%;animation:spin 0.8s linear infinite;"></div>' +
                      '<div style="margin-top:0.5rem;font-size:0.9rem;">请求中...</div>' +
                      '</div>' +
                      '<div id="modalMetrics" style="display:none;margin-top:1.25rem;">' +
                      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.75rem;">' +
                      '<div class="metric-card" style="padding:0.85rem;background:var(--bg-page);border-radius:var(--radius-sm);border:1px solid var(--border-color);text-align:center;"><div style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:0.3rem;">总耗时</div><div id="metricTotalTime" style="font-size:1.1rem;font-weight:700;color:var(--text-primary);">—</div></div>' +
                      '<div class="metric-card" style="padding:0.85rem;background:var(--bg-page);border-radius:var(--radius-sm);border:1px solid var(--border-color);text-align:center;"><div style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:0.3rem;">Token 总量</div><div id="metricTotalTokens" style="font-size:1.1rem;font-weight:700;color:var(--text-primary);">—</div></div>' +
                      '<div class="metric-card" style="padding:0.85rem;background:var(--bg-page);border-radius:var(--radius-sm);border:1px solid var(--border-color);text-align:center;"><div style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:0.3rem;">Prompt Tokens</div><div id="metricPromptTokens" style="font-size:1.1rem;font-weight:700;color:var(--text-primary);">—</div></div>' +
                      '<div class="metric-card" style="padding:0.85rem;background:var(--bg-page);border-radius:var(--radius-sm);border:1px solid var(--border-color);text-align:center;"><div style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:0.3rem;">Completion Tokens</div><div id="metricCompletionTokens" style="font-size:1.1rem;font-weight:700;color:var(--text-primary);">—</div></div>' +
                      '<div class="metric-card" style="padding:0.85rem;background:var(--bg-page);border-radius:var(--radius-sm);border:1px solid var(--border-color);text-align:center;"><div style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:0.3rem;">生成速度</div><div id="metricSpeed" style="font-size:1.1rem;font-weight:700;color:var(--text-primary);">—</div></div>' +
                      '</div></div>' +
                      '<div id="modalError" style="display:none;margin-top:1.25rem;padding:1rem;background:var(--danger-bg);border:1px solid #fecaca;border-radius:var(--radius-sm);color:var(--danger-color);font-size:0.9rem;"><div id="modalErrorMessage"></div></div>' +
                      '<div id="modalContent" style="display:none;margin-top:1.25rem;"><label style="display:block;font-size:0.88rem;font-weight:600;color:var(--text-primary);margin-bottom:0.5rem;">响应内容</label><pre id="modalContentText" style="max-height:300px;overflow-y:auto;padding:1rem;background:var(--bg-page);border:1px solid var(--border-color);border-radius:var(--radius-sm);font-size:0.85rem;line-height:1.6;white-space:pre-wrap;color:var(--text-primary);margin:0;"></pre></div>' +
                      '<div id="modalRawResponse" style="display:none;margin-top:1.25rem;"><a id="modalRawToggle" href="javascript:void(0)" onclick="window.toggleModalRawResponse()" style="font-size:0.85rem;color:var(--accent-color);text-decoration:none;display:inline-flex;align-items:center;gap:0.3rem;"><span id="modalRawToggleIcon">▼</span> 查看原始响应</a><pre id="modalRawJson" style="display:none;max-height:250px;overflow-y:auto;padding:0.85rem;background:var(--bg-page);border:1px solid var(--border-color);border-radius:var(--radius-sm);font-size:0.8rem;line-height:1.5;white-space:pre-wrap;color:var(--text-secondary);margin-top:0.5rem;"></pre></div>' +
                      '</div></div>';
                    document.body.appendChild(testModalContainer);

                    // Store config for test
                    window.modelTestModalConfig = config;
                  });
                });

                function escapeHtml(text) {
                  var div = document.createElement('div');
                  div.textContent = text;
                  return div.innerHTML;
                }

                window.closeModelTestModal = function() {
                  var backdrop = document.getElementById('modelTestModalBackdrop');
                  var modal = document.getElementById('modelTestModal');
                  if (backdrop) backdrop.remove();
                  if (modal) modal.remove();
                };

                window.runModelTest = function() {
                  var btn = document.getElementById('modalTestBtn');
                  var loading = document.getElementById('modalTestLoading');
                  var metrics = document.getElementById('modalMetrics');
                  var error = document.getElementById('modalError');
                  var content = document.getElementById('modalContent');
                  var rawResponse = document.getElementById('modalRawResponse');
                  var message = document.getElementById('modalTestMessage').value || '请介绍一下你自己';

                  btn.disabled = true;
                  btn.style.opacity = '0.6';
                  btn.textContent = '请求中...';
                  loading.style.display = 'block';
                  metrics.style.display = 'none';
                  error.style.display = 'none';
                  content.style.display = 'none';
                  rawResponse.style.display = 'none';

                  document.querySelectorAll('.metric-card > div:last-child').forEach(function(el) {
                    el.textContent = '—';
                  });

                  window.modelTestModalStartTime = Date.now();

                  fetch('/admin/models/test', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      provider: window.modelTestModalConfig.provider,
                      baseUrl: window.modelTestModalConfig.baseUrl,
                      apiKey: window.modelTestModalConfig.apiKey || '',
                      realModel: window.modelTestModalConfig.realModel,
                      message: message
                    })
                  })
                  .then(function(res) { return res.json(); })
                  .then(function(data) {
                    var totalTime = Date.now() - window.modelTestModalStartTime;

                    btn.disabled = false;
                    btn.style.opacity = '1';
                    btn.textContent = '发送';
                    loading.style.display = 'none';

                    if (data.success === false) {
                      error.style.display = 'block';
                      document.getElementById('modalErrorMessage').textContent = data.message || '请求失败';
                      rawResponse.style.display = 'block';
                      document.getElementById('modalRawJson').textContent = JSON.stringify(data, null, 2);
                    } else {
                      metrics.style.display = 'block';

                      var usage = data.usage || {};
                      var promptTokens = usage.prompt_tokens || 0;
                      var completionTokens = usage.completion_tokens || 0;
                      var totalTokens = usage.total_tokens || (promptTokens + completionTokens);

                      var totalTimeSeconds = (totalTime / 1000).toFixed(2);
                      document.getElementById('metricTotalTime').textContent = totalTimeSeconds + 's';
                      document.getElementById('metricTotalTokens').textContent = totalTokens;
                      document.getElementById('metricPromptTokens').textContent = promptTokens;
                      document.getElementById('metricCompletionTokens').textContent = completionTokens;

                      if (completionTokens > 0 && totalTime > 0) {
                        var speed = (completionTokens / (totalTime / 1000)).toFixed(1);
                        document.getElementById('metricSpeed').textContent = speed + ' t/s';
                      } else {
                        document.getElementById('metricSpeed').textContent = '—';
                      }

                      if (data.content) {
                        content.style.display = 'block';
                        document.getElementById('modalContentText').textContent = data.content;
                      }

                      rawResponse.style.display = 'block';
                      document.getElementById('modalRawJson').textContent = JSON.stringify(data, null, 2);
                    }
                  })
                  .catch(function(err) {
                    btn.disabled = false;
                    btn.style.opacity = '1';
                    btn.textContent = '发送';
                    loading.style.display = 'none';

                    error.style.display = 'block';
                    document.getElementById('modalErrorMessage').textContent = '网络错误: ' + err.message;
                  });
                };

                window.toggleModalRawResponse = function() {
                  var rawJson = document.getElementById('modalRawJson');
                  var icon = document.getElementById('modalRawToggleIcon');
                  var toggle = document.getElementById('modalRawToggle');

                  if (rawJson.style.display === 'none') {
                    rawJson.style.display = 'block';
                    icon.textContent = '▲';
                    toggle.innerHTML = toggle.innerHTML.replace('查看原始响应', '隐藏原始响应');
                  } else {
                    rawJson.style.display = 'none';
                    icon.textContent = '▼';
                    toggle.innerHTML = toggle.innerHTML.replace('隐藏原始响应', '查看原始响应');
                  }
                };

                // Close on ESC
                document.addEventListener('keydown', function(e) {
                  if (e.key === 'Escape') {
                    window.closeModelTestModal();
                  }
                });

                // Add spin animation style
                if (!document.getElementById('modalSpinAnimation')) {
                  var style = document.createElement('style');
                  style.id = 'modalSpinAnimation';
                  style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
                  document.head.appendChild(style);
                }
              })();
            `
          }}
        />
      </body>
    </html>
  );
};
