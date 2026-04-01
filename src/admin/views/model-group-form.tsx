import { FC } from 'hono/jsx';
import { Layout } from '../components/Layout.js';
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
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, "'");
}

export const ModelGroupFormPage: FC<Props> = (props) => {
  const { models, group, isEdit = false, error } = props;

  const safeValue = (val: string | undefined) => val ? escapeHtml(val) : '';
  const selectedModels = group?.models || [];
  const groupName = safeValue(group?.name);

  // 可用模型 = 所有模型 - 已选模型
  const availableModels = models.filter(m => !selectedModels.includes(m.customModel));

  return (
    <Layout title={isEdit ? '编辑 Model Group' : '新增 Model Group'}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1>{isEdit ? '编辑' : '新增'} Model Group</h1>
        <a href="/admin/model-groups" role="button" class="secondary">返回列表</a>
      </div>

      {error && (
        <article aria-label="错误提示" style={{ backgroundColor: '#fee2e2', color: '#991b1b' }}>
          <strong>错误：</strong> {error}
        </article>
      )}

      <form method="post" action={isEdit ? `/admin/model-groups/edit/${groupName}` : '/admin/model-groups'}>
        <label>
          组名
          <input
            name="name"
            type="text"
            placeholder="例如：gpt-4-pool"
            value={safeValue(group?.name)}
            required
          />
          <small>只能包含字母、数字、下划线、中划线</small>
        </label>

        {/* Hidden input 存储已选模型列表（JSON 格式） - 必须在主表单内 */}
        <input type="hidden" name="models" value={safeValue(JSON.stringify(selectedModels))} />

        <label>
          描述
          <textarea
            name="desc"
            placeholder="描述这个模型组的用途或备注..."
            rows={3}
          >
            {group?.desc || ''}
          </textarea>
          <small>用于记录模型组的用途或备注</small>
        </label>

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
          <button type="submit">{isEdit ? '保存修改' : '添加 Model Group'}</button>
          <a href="/admin/model-groups" role="button" class="secondary">
            取消
          </a>
        </div>
      </form>

      {/* 模型选择区域 - 放在主表单外面，使用独立的操作 */}
      <label style={{ marginTop: '1.5rem' }}>
        选择模型
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '1rem', marginTop: '0.5rem' }}>
          {/* 左侧：可用模型 */}
          <div style={{ border: '1px solid #ddd', borderRadius: '0.5rem', padding: '0.75rem', maxHeight: '20rem', overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '0.9rem', color: '#666' }}>可用模型</h3>
            {availableModels.length === 0 ? (
              <p style={{ color: '#666', fontSize: '0.85rem' }}>暂无可用模型</p>
            ) : (
              availableModels.map((model) => (
                <div
                  key={model.customModel}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '0.5rem',
                    marginBottom: '0.25rem',
                    borderRadius: '0.25rem',
                    backgroundColor: '#f9fafb',
                  }}
                >
                  <span style={{ fontSize: '0.85rem' }}>
                    {model.customModel}
                    {model.desc ? <span style={{ color: '#666' }}> ({model.desc})</span> : null}
                  </span>
                  <a
                    href={`/admin/model-groups/edit/${groupName}/add-model?modelName=${encodeURIComponent(model.customModel)}`}
                    class="secondary"
                    style={{ padding: '2px 8px', fontSize: '12px', textDecoration: 'none', display: 'inline-block' }}
                  >
                    + 添加
                  </a>
                </div>
              ))
            )}
          </div>

          {/* 中间：操作提示 */}
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', color: '#666', fontSize: '0.85rem' }}>
            <span>← 添加 →</span>
            <span>← 删除/移动 →</span>
          </div>

          {/* 右侧：已选模型 */}
          <div style={{ border: '1px solid #ddd', borderRadius: '0.5rem', padding: '0.75rem', maxHeight: '20rem', overflowY: 'auto', backgroundColor: '#f0f9ff' }}>
            <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '0.9rem', color: '#666' }}>已选模型（按顺序）</h3>
            {selectedModels.length === 0 ? (
              <p style={{ color: '#666', fontSize: '0.85rem' }}>暂无已选模型</p>
            ) : (
              selectedModels.map((modelName, index) => {
                const model = models.find(m => m.customModel === modelName);
                const modelDesc = model?.desc || '';
                return (
                  <div
                    key={modelName}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '0.5rem',
                      marginBottom: '0.25rem',
                      borderRadius: '0.25rem',
                      backgroundColor: '#fff',
                      border: '1px solid #bfdbfe',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ color: '#666', fontSize: '12px', minWidth: '20px' }}>{index + 1}.</span>
                      <span style={{ fontSize: '0.85rem' }}>
                        {modelName}
                        {modelDesc && <span style={{ color: '#666' }}> ({modelDesc})</span>}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      {/* 上移按钮 */}
                      {index > 0 ? (
                        <a
                          href={`/admin/model-groups/edit/${groupName}/move-model?modelName=${encodeURIComponent(modelName)}&direction=up`}
                          class="secondary"
                          style={{ padding: '2px 6px', fontSize: '12px', textDecoration: 'none', display: 'inline-block' }}
                        >
                          ↑
                        </a>
                      ) : (
                        <span class="secondary" style={{ padding: '2px 6px', fontSize: '12px', display: 'inline-block', opacity: 0.5 }}>↑</span>
                      )}
                      {/* 下移按钮 */}
                      {index < selectedModels.length - 1 ? (
                        <a
                          href={`/admin/model-groups/edit/${groupName}/move-model?modelName=${encodeURIComponent(modelName)}&direction=down`}
                          class="secondary"
                          style={{ padding: '2px 6px', fontSize: '12px', textDecoration: 'none', display: 'inline-block' }}
                        >
                          ↓
                        </a>
                      ) : (
                        <span class="secondary" style={{ padding: '2px 6px', fontSize: '12px', display: 'inline-block', opacity: 0.5 }}>↓</span>
                      )}
                      {/* 删除按钮 */}
                      {selectedModels.length > 1 && (
                        <a
                          href={`/admin/model-groups/edit/${groupName}/remove-model?modelName=${encodeURIComponent(modelName)}`}
                          class="secondary"
                          style={{ padding: '2px 6px', fontSize: '12px', textDecoration: 'none', display: 'inline-block' }}
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
        <small>至少选择一个模型，可按需调整顺序</small>
      </label>
    </Layout>
  );
};