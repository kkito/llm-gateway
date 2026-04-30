import { FC } from 'hono/jsx';
import { Layout } from '../components/Layout.js';
import type { UiSettings } from '../../config.js';

interface Props {
  settings?: UiSettings;
  success?: string;
  error?: string;
}

export const AnnouncementPage: FC<Props> = (props) => {
  const settings = props.settings || { enabled: false, announcementMarkdown: '' };

  return (
    <Layout title="公告管理 - LLM Gateway">
      <style dangerouslySetInnerHTML={{ __html: `
        .container { max-width: 800px; margin: 0 auto; padding: 1rem; }
        .card { background: #fff; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); padding: 1rem; margin-bottom: 1rem; }
        .form-group { margin-bottom: 1rem; }
        .form-group label { display: block; font-weight: 600; margin-bottom: 0.25rem; font-size: 0.85rem; }
        .form-group input[type="checkbox"] { accent-color: #6366f1; }
        .form-group textarea { width: 100%; min-height: 200px; padding: 0.5rem; border: 1px solid #e5e7eb; border-radius: 8px; font-family: monospace; font-size: 0.8rem; }
        .preview { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 0.75rem; margin-top: 1rem; }
        .preview h4 { margin: 0 0 0.5rem 0; font-size: 0.8rem; color: #6b7280; }
        .alert-success { background: #d1fae5; color: #065f46; padding: 0.5rem 0.75rem; border-radius: 8px; font-size: 0.8rem; margin-bottom: 1rem; }
        .alert-error { background: #fee2e2; color: #991b1b; padding: 0.5rem 0.75rem; border-radius: 8px; font-size: 0.8rem; margin-bottom: 1rem; }
        .btn-primary { background: linear-gradient(135deg, #6366f1, #4f46e5); color: white; border: none; padding: 0.4rem 0.8rem; border-radius: 8px; font-size: 0.8rem; cursor: pointer; }
      `}} />

      <div class="container">
        <h2>公告管理</h2>
        <p style={{fontSize: '0.8rem', color: '#6b7280', marginBottom: '1rem'}}>
          编辑将在前台首页顶部显示的公告内容（支持 Markdown 格式）
        </p>

        {props.success && (
          <div class="alert-success">{props.success}</div>
        )}
        {props.error && (
          <div class="alert-error">{props.error}</div>
        )}

        <div class="card">
          <form method="post" action="/admin/announcement">
            <div class="form-group">
              <label>
                <input type="checkbox" name="enabled" checked={settings.enabled} />
                {' '}启用公告
              </label>
            </div>

            <div class="form-group">
              <label>Markdown 内容</label>
              <textarea
                name="announcementMarkdown"
                placeholder="# 公告标题&#10;&#10;这里是公告内容，支持 **Markdown** 格式..."
              >{settings.announcementMarkdown || ''}</textarea>
            </div>

            <button type="submit" class="btn-primary">保存</button>
          </form>
        </div>

        {(settings.announcementMarkdown && settings.enabled) ? (
          <div class="card">
            <div class="preview">
              <h4>预览</h4>
              <div id="preview-content"></div>
            </div>
          </div>
        ) : null}

        <a href="/admin/models" style={{fontSize: '0.8rem', color: '#6366f1'}}>← 返回模型管理</a>
      </div>

      {settings.announcementMarkdown ? (
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            var md = ${JSON.stringify(settings.announcementMarkdown)};
            if (typeof marked !== 'undefined') {
              document.getElementById('preview-content').innerHTML = marked.parse ? marked.parse(md) : marked(md);
            }
          })();
        `}} />
      ) : null}
    </Layout>
  );
};
