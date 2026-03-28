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
}

export const UsersPage: FC<Props> = (props) => {
  return (
    <Layout title="用户管理">
      <h1>用户管理</h1>

      {props.error && (
        <article aria-label="错误提示" style={{ backgroundColor: '#fee2e2', color: '#991b1b' }}>
          <strong>错误：</strong> {props.error}
        </article>
      )}

      <a href="/admin/users/new" role="button">
        新增用户
      </a>

      {props.users.length === 0 ? (
        <p style={{ marginTop: '1rem', color: '#666' }}>暂无用户，请点击"新增用户"添加</p>
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
