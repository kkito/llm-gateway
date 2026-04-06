import { FC } from 'hono/jsx';
import { TopbarNav } from '../components/TopbarNav.js';
import type { ModelGroup, ProviderConfig } from '../../config.js';

interface Props {
  models: ProviderConfig[];
  group?: ModelGroup;
  error?: string;
  isEdit?: boolean;
}

// HTML 转义函数，防止 XSS 攻击
function escapeHtml(str: string | number | undefined): string {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const ModelGroupFormPage: FC<Props> = (props) => {
  const { models, group, isEdit = false, error } = props;

  const safeValue = (val: string | undefined) => val ? escapeHtml(val) : '';
  const selectedModels = group?.models || [];
  const groupName = safeValue(group?.name);

  // 可用模型 = 所有模型 - 已选模型
  const availableModels = models.filter(m => !selectedModels.includes(m.customModel));

  return (
    <html lang="zh-CN">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{isEdit ? '编辑 Model Group' : '新增 Model Group'} - LLM Gateway</title>
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

          .form-input,
          .form-textarea {
            width: 100%;
            padding: 0.7rem 0.9rem;
            border: 1.5px solid var(--border-color);
            border-radius: var(--radius-sm);
            font-size: 0.92rem;
            background: var(--bg-page);
            font-family: inherit;
            outline: none;
          }

          .form-input:focus,
          .form-textarea:focus {
            border-color: var(--accent-color);
            box-shadow: 0 0 0 3px hsl(245 80% 58% / 0.12);
            background: var(--bg-card);
          }

          .form-hint {
            display: block;
            font-size: 0.78rem;
            color: var(--text-secondary);
            margin-top: 0.35rem;
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

          .btn-small {
            padding: 0.35rem 0.65rem;
            font-size: 0.8rem;
          }

          .error-banner {
            background: #fef2f2;
            border: 1px solid #fecaca;
            color: #ef4444;
            padding: 0.85rem 1.15rem;
            border-radius: var(--radius-sm);
            margin-bottom: 1.5rem;
            font-weight: 500;
          }

          /* 模型选择器样式 */
          .model-selector {
            display: grid;
            grid-template-columns: 1fr auto 1fr;
            gap: 1rem;
            margin-top: 0.5rem;
          }

          .model-list {
            border: 1px solid var(--border-color);
            border-radius: var(--radius-sm);
            padding: 0.75rem;
            max-height: 20rem;
            overflow-y: auto;
            background: var(--bg-page);
          }

          .model-list-title {
            margin: 0 0 0.75rem 0;
            font-size: 0.9rem;
            font-weight: 600;
            color: var(--text-secondary);
          }

          .model-list-empty {
            color: var(--text-secondary);
            font-size: 0.85rem;
          }

          .model-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 0.5rem;
            margin-bottom: 0.25rem;
            border-radius: 6px;
            background-color: var(--bg-card);
          }

          .model-item-name {
            font-size: 0.85rem;
          }

          .model-item-name small {
            color: var(--text-secondary);
          }

          .model-item-desc {
            color: var(--text-secondary);
          }

          .model-list-hint {
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            gap: 0.5rem;
            color: var(--text-secondary);
            font-size: 0.85rem;
          }

          .model-list.selected {
            background-color: #eef2ff;
            border-color: #c7d2fe;
          }

          .model-item.selected {
            background-color: var(--bg-card);
            border: 1px solid #c7d2fe;
          }

          .selected-index {
            color: var(--text-secondary);
            font-size: 12px;
            min-width: 20px;
          }

          .model-actions {
            display: flex;
            gap: 0.25rem;
          }

          .btn-icon {
            padding: 2px 6px;
            font-size: 12px;
            min-width: 24px;
          }

          .btn-icon.disabled {
            opacity: 0.5;
            pointer-events: none;
          }

          /* 复选框模式 */
          .checkbox-list {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
          }

          .checkbox-item {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.5rem;
            border-radius: 6px;
            background-color: var(--bg-card);
            cursor: pointer;
          }

          .checkbox-item:hover {
            background-color: #f0f0f5;
          }

          .checkbox-item input[type="checkbox"] {
            width: 16px;
            height: 16px;
            accent-color: var(--accent-color);
          }

          @media (max-width: 768px) {
            .main-content { padding: 1.5rem 1rem 3rem !important; }
            .form-card { padding: 1.5rem; }
            .model-selector { grid-template-columns: 1fr; }
            .model-list-hint { display: none; }
          }
        `}</style>
      </head>
      <body>
        <TopbarNav title={isEdit ? '编辑 Model Group' : '新增 Model Group'} activePath="/admin/model-groups">
          <div class="form-card">
            <h1 class="form-title">{isEdit ? '编辑' : '新增'} Model Group</h1>

            {error && (
              <div class="error-banner">
                <strong>错误：</strong> {error}
              </div>
            )}

            <form method="post" action={isEdit ? `/admin/model-groups/edit/${groupName}` : '/admin/model-groups'}>
              <div class="form-group">
                <label class="form-label" for="name">
                  组名
                  <input
                    class="form-input"
                    id="name"
                    name="name"
                    type="text"
                    placeholder="例如：gpt-4-pool"
                    value={safeValue(group?.name)}
                    required
                  />
                  <span class="form-hint">只能包含字母、数字、下划线、中划线</span>
                </label>
              </div>

              {/* Hidden input 存储已选模型列表（JSON 格式） - 必须在主表单内 */}
              <input type="hidden" name="models" value={safeValue(JSON.stringify(selectedModels))} />

              <div class="form-group">
                <label class="form-label" for="desc">
                  描述
                  <textarea
                    class="form-textarea"
                    id="desc"
                    name="desc"
                    placeholder="描述这个模型组的用途或备注..."
                    rows={3}
                  >
                    {group?.desc || ''}
                  </textarea>
                  <span class="form-hint">用于记录模型组的用途或备注</span>
                </label>
              </div>

              <div class="form-actions">
                <button type="submit" class="btn btn-primary">{isEdit ? '保存修改' : '添加 Model Group'}</button>
                <a href="/admin/model-groups" class="btn btn-secondary">取消</a>
              </div>
            </form>

            {/* 模型选择区域 - 放在主表单外面，使用独立的操作 */}
            <div class="form-group" style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border-color)' }}>
              <label class="form-label">
                选择模型
                {isEdit ? (
                  /* 编辑模式：使用左右列表 + 添加/删除/移动按钮 */
                  <div class="model-selector">
                    {/* 左侧：可用模型 */}
                    <div class="model-list">
                      <h3 class="model-list-title">可用模型</h3>
                      {availableModels.length === 0 ? (
                        <p class="model-list-empty">暂无可用模型</p>
                      ) : (
                        availableModels.map((model) => (
                          <div class="model-item" key={model.customModel}>
                            <span class="model-item-name">
                              {model.customModel}
                              {model.desc ? <span class="model-item-desc"> ({model.desc})</span> : null}
                            </span>
                            <a
                              href={`/admin/model-groups/edit/${groupName}/add-model?modelName=${encodeURIComponent(model.customModel)}`}
                              class="btn btn-secondary btn-small btn-icon"
                            >
                              + 添加
                            </a>
                          </div>
                        ))
                      )}
                    </div>

                    {/* 中间：操作提示 */}
                    <div class="model-list-hint">
                      <span>← 添加 →</span>
                      <span>← 删除/移动 →</span>
                    </div>

                    {/* 右侧：已选模型 */}
                    <div class="model-list selected">
                      <h3 class="model-list-title">已选模型（按顺序）</h3>
                      {selectedModels.length === 0 ? (
                        <p class="model-list-empty">暂无已选模型</p>
                      ) : (
                        selectedModels.map((modelName, index) => {
                          const model = models.find(m => m.customModel === modelName);
                          const modelDesc = model?.desc || '';
                          return (
                            <div class="model-item selected" key={modelName}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span class="selected-index">{index + 1}.</span>
                                <span class="model-item-name">
                                  {modelName}
                                  {modelDesc && <span class="model-item-desc"> ({modelDesc})</span>}
                                </span>
                              </div>
                              <div class="model-actions">
                                {/* 上移按钮 */}
                                {index > 0 ? (
                                  <a
                                    href={`/admin/model-groups/edit/${groupName}/move-model?modelName=${encodeURIComponent(modelName)}&direction=up`}
                                    class="btn btn-secondary btn-small btn-icon"
                                  >
                                    ↑
                                  </a>
                                ) : (
                                  <span class="btn btn-secondary btn-small btn-icon disabled">↑</span>
                                )}
                                {/* 下移按钮 */}
                                {index < selectedModels.length - 1 ? (
                                  <a
                                    href={`/admin/model-groups/edit/${groupName}/move-model?modelName=${encodeURIComponent(modelName)}&direction=down`}
                                    class="btn btn-secondary btn-small btn-icon"
                                  >
                                    ↓
                                  </a>
                                ) : (
                                  <span class="btn btn-secondary btn-small btn-icon disabled">↓</span>
                                )}
                                {/* 删除按钮 */}
                                {selectedModels.length > 1 && (
                                  <a
                                    href={`/admin/model-groups/edit/${groupName}/remove-model?modelName=${encodeURIComponent(modelName)}`}
                                    class="btn btn-secondary btn-small btn-icon"
                                  >
                                    ×
                                  </a>
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                ) : (
                  /* 新增模式：使用复选框选择模型 */
                  <div class="model-list">
                    {models.length === 0 ? (
                      <p class="model-list-empty">暂无可用模型</p>
                    ) : (
                      <div class="checkbox-list">
                        {models.map((model) => (
                          <label class="checkbox-item" key={model.customModel}>
                            <input
                              type="checkbox"
                              name="modelCheckbox"
                              value={model.customModel}
                              data-model-name={model.customModel}
                            />
                            <span class="model-item-name">
                              {model.customModel}
                              {model.desc ? <span class="model-item-desc"> ({model.desc})</span> : null}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <span class="form-hint">至少选择一个模型{isEdit ? '，可按需调整顺序' : ''}</span>
              </label>

              {/* 新增模式：添加 JavaScript 处理复选框变化 */}
              {!isEdit && (
                <script dangerouslySetInnerHTML={{ __html: `
                  document.querySelectorAll('input[name="modelCheckbox"]').forEach(cb => {
                    cb.addEventListener('change', function() {
                      const checkboxes = document.querySelectorAll('input[name="modelCheckbox"]:checked');
                      const selectedModels = Array.from(checkboxes).map(cb => cb.value);
                      document.querySelector('input[name="models"]').value = JSON.stringify(selectedModels);
                    });
                  });
                `}} />
              )}
            </div>
          </div>
        </TopbarNav>
      </body>
    </html>
  );
};