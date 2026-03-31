import { FC } from 'hono/jsx';
import { Layout } from '../components/Layout.js';
import type { ProviderConfig } from '../../config.js';

interface Props {
  models: ProviderConfig[];
  error?: string;
}

export const ModelsPage: FC<Props> = (props) => {
  return (
    <Layout title="模型列表">
      <h1>模型列表</h1>

      {props.error && (
        <article aria-label="错误提示" style={{ backgroundColor: '#fee2e2', color: '#991b1b' }}>
          <strong>错误：</strong> {props.error}
        </article>
      )}

      <a href="/admin/models/new" role="button">
        新增模型
      </a>

      {props.models.length === 0 ? (
        <p style={{ marginTop: '1rem', color: '#666' }}>暂无模型配置，请点击"新增模型"添加</p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>顺序</th>
                <th>自定义模型</th>
                <th>实际模型</th>
                <th>Provider</th>
                <th>Base URL</th>
                <th>描述</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {props.models.map((model, index) => (
                <tr key={model.customModel}>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <button
                        type="button"
                        class="secondary"
                        style={{ padding: '2px 6px', fontSize: '12px' }}
                        data-move-url={`/admin/models/move/${model.customModel}`}
                        data-direction="up"
                        disabled={index === 0}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        class="secondary"
                        style={{ padding: '2px 6px', fontSize: '12px' }}
                        data-move-url={`/admin/models/move/${model.customModel}`}
                        data-direction="down"
                        disabled={index === props.models.length - 1}
                      >
                        ↓
                      </button>
                    </div>
                  </td>
                  <td>{model.customModel}</td>
                  <td>{model.realModel}</td>
                  <td>{model.provider}</td>
                  <td>{model.baseUrl}</td>
                  <td>{model.desc || '-'}</td>
                  <td>
                    <a
                      href={`/admin/models/edit/${model.customModel}`}
                      role="button"
                      style={{ marginRight: '0.5rem' }}
                    >
                      编辑
                    </a>
                    <a
                      href={`/admin/models/${encodeURIComponent(model.customModel)}/limits`}
                      role="button"
                      class="secondary"
                      style={{ marginRight: '0.5rem', fontSize: '12px', padding: '4px 8px' }}
                    >
                      管理限制
                    </a>
                    <button
                      type="button"
                      class="secondary"
                      data-delete-url={`/admin/models/delete/${model.customModel}`}
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
        </>
      )}
    </Layout>
  );
};
