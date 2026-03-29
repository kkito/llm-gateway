import { FC } from 'hono/jsx';
import { Layout } from '../components/Layout.js';

export interface UserApiKey {
  name: string;
  apikey: string;
  desc?: string;
}

interface Props {
  users: UserApiKey[];
  error?: string;
  authEnabled?: boolean;
}

export const UsersPage: FC<Props> = (props) => {
  const authEnabled = props.authEnabled !== false;
  const hasUsers = props.users.length > 0;

  return (
    <Layout title="用户管理">
      <h1>用户管理</h1>

      {props.error && (
        <article aria-label="错误提示" style={{ backgroundColor: '#fee2e2', color: '#991b1b' }}>
          <strong>错误：</strong> {props.error}
        </article>
      )}

      <div style={{display: 'flex', gap: '0.5rem', marginBottom: '1rem', alignItems: 'center'}}>
        <a href="/admin/users/new" role="button">
          新增用户
        </a>

        {/* 启用/禁用切换按钮 */}
        <form method="post" action="/admin/users/toggle" style={{display: 'inline'}}>
          <input type="hidden" name="enabled" value={authEnabled ? 'false' : 'true'} />
          <button
            type="submit"
            class="secondary"
            style={{
              backgroundColor: authEnabled ? '#dc2626' : '#10b981',
              color: 'white',
              border: 'none',
              padding: '0.5rem 1rem',
              borderRadius: '4px',
              cursor: 'pointer',
              opacity: !authEnabled && !hasUsers ? 0.5 : 1
            }}
            disabled={!authEnabled && !hasUsers}
          >
            {authEnabled ? '禁用用户认证' : '启用用户认证'}
          </button>
        </form>

        {/* 空用户时的提示信息 */}
        {!authEnabled && !hasUsers && (
          <span style={{color: '#666', fontSize: '0.9rem'}}>
            提示：请先添加用户后再启用认证
          </span>
        )}
      </div>

      {props.users.length === 0 ? (
        <p style={{ marginTop: '1rem', color: '#666' }}>
          {authEnabled
            ? '暂无用户，请点击"新增用户"添加'
            : '用户认证已禁用，所有用户均可直接访问'}
        </p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>用户名称</th>
                <th>API Key</th>
                <th>描述</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {props.users.map((user) => (
                <tr key={user.name}>
                  <td>{user.name}</td>
                  <td>
                    <code>{user.apikey}</code>
                  </td>
                  <td>{user.desc || '-'}</td>
                  <td>
                    <a
                      href={`/admin/users/edit/${user.name}`}
                      style={{marginRight: '0.5rem'}}
                    >
                      编辑
                    </a>
                    <button
                      type="button"
                      class="secondary"
                      data-delete-url={`/admin/users/delete/${user.name}`}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <script
            dangerouslySetInnerHTML={{
              __html: `
                (function() {
                  // 删除功能
                  document.querySelectorAll('button[data-delete-url]').forEach(function(btn) {
                    btn.addEventListener('click', function() {
                      var url = this.getAttribute('data-delete-url');
                      var userName = url.split('/').pop();
                      if (confirm('确定要删除用户 "' + userName + '" 吗？')) {
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
        </>
      )}
    </Layout>
  );
};
