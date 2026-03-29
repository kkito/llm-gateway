import { FC } from 'hono/jsx';
import { Layout } from '../components/Layout.js';
import type { ApiKey, ProviderType } from '../../config.js';

interface Props {
  apiKeys: Omit<ApiKey, 'key'>[];
  error?: string;
  success?: string;
  editingKey?: Omit<ApiKey, 'key'>;
}

export const ApiKeysPage: FC<Props> = (props) => {
  const isEditing = !!props.editingKey;

  return (
    <Layout title="API Key 管理">
      <h1>API Key 管理</h1>

      {props.error && (
        <article aria-label="错误提示" style={{ backgroundColor: '#fee2e2', color: '#991b1b' }}>
          <strong>错误：</strong> {props.error}
        </article>
      )}

      {props.success && (
        <article aria-label="成功提示" style={{ backgroundColor: '#dcfce7', color: '#166534' }}>
          <strong>成功：</strong> {props.success}
        </article>
      )}

      {/* API Key 列表 */}
      <section>
        <h2>已存储的 API Key</h2>
        {props.apiKeys.length === 0 ? (
          <p>暂无存储的 API Key</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>Provider</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {props.apiKeys.map((key) => (
                <tr key={key.id}>
                  <td>{key.name}</td>
                  <td>{key.provider === 'openai' ? 'OpenAI' : 'Anthropic'}</td>
                  <td>{new Date(key.createdAt).toLocaleDateString()}</td>
                  <td>
                    <a href={`/admin/api-keys/edit/${key.id}`}>编辑</a>
                    <form method="post" action={`/admin/api-keys/delete/${key.id}`} style="display: inline; margin-left: 1rem">
                      <button type="submit" style="color: red; border: none; background: none; cursor: pointer;">
                        删除
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 新增/编辑表单 */}
      <section>
        <h2>{isEditing ? '编辑 API Key' : '新增 API Key'}</h2>
        <form method="post" action={isEditing ? `/admin/api-keys/edit/${props.editingKey!.id}` : '/admin/api-keys'}>
          <label>
            名称
            <input
              name="name"
              type="text"
              placeholder="例如：我的 OpenAI Key"
              value={props.editingKey?.name || ''}
              required
            />
            <small>用于识别此 API Key</small>
          </label>

          <label>
            Provider
            <select name="provider" required>
              <option value="">请选择...</option>
              <option
                value="openai"
                selected={props.editingKey?.provider === 'openai'}
              >
                OpenAI
              </option>
              <option
                value="anthropic"
                selected={props.editingKey?.provider === 'anthropic'}
              >
                Anthropic
              </option>
            </select>
          </label>

          <label>
            API Key
            <input
              name="key"
              type="password"
              placeholder={isEditing ? '留空则保持原密钥不变' : '请输入 API Key'}
              required={!isEditing}
            />
            {isEditing && <small>留空则保持原密钥不变</small>}
          </label>

          <button type="submit">{isEditing ? '保存修改' : '添加 API Key'}</button>
          {isEditing && (
            <a href="/admin/api-keys" role="button" class="secondary" style="margin-left: 0.5rem">
              取消
            </a>
          )}
        </form>
      </section>
    </Layout>
  );
};