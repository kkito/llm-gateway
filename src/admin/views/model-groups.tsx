import { FC } from 'hono/jsx';
import { Layout } from '../components/Layout.js';
import type { ModelGroup } from '../../config.js';

interface Props {
  modelGroups: ModelGroup[];
  error?: string;
  success?: string;
}

export const ModelGroupsPage: FC<Props> = (props) => {
  return (
    <Layout title="Model Groups">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1>Model Groups</h1>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <a href="/admin/models" role="button" class="secondary">← 返回模型管理</a>
          <a href="/admin/model-groups/new" role="button">+ 新增</a>
        </div>
      </div>

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

      {props.modelGroups.length === 0 ? (
        <p style={{ marginTop: '1rem', color: '#666' }}>暂无 Model Group 配置</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>组名</th>
              <th>模型数</th>
              <th>描述</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {props.modelGroups.map((group) => (
              <tr key={group.name}>
                <td>{group.name}</td>
                <td>{group.models.length}</td>
                <td>{group.desc || '-'}</td>
                <td>
                  <a
                    href={`/admin/model-groups/edit/${encodeURIComponent(group.name)}`}
                    role="button"
                    style={{ marginRight: '0.5rem' }}
                  >
                    编辑
                  </a>
                  <button
                    type="button"
                    class="secondary"
                    data-delete-url={`/admin/model-groups/delete/${encodeURIComponent(group.name)}`}
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <script
        dangerouslySetInnerHTML={{
          __html: `
            (function() {
              // 删除功能
              document.querySelectorAll('button[data-delete-url]').forEach(function(btn) {
                btn.addEventListener('click', function() {
                  var url = this.getAttribute('data-delete-url');
                  var groupName = url.split('/').pop();
                  if (confirm('确定要删除 Model Group "' + groupName + '" 吗？')) {
                    var form = document.createElement('form');
                    form.method = 'POST';
                    form.action = url;
                    document.body.appendChild(form);
                    form.submit();
                  }
                });
              });
            })();
          `
        }}
      />
    </Layout>
  );
};
