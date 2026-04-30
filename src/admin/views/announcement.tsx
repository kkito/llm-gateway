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
    <Layout
      title="公告管理 - LLM Gateway"
      head={<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>}
    >
      <div class="container">
        <h2>公告管理</h2>
        <p>
          编辑将在前台首页顶部显示的公告内容（支持 Markdown 格式）
        </p>

        {props.success && (
          <div class="alert success">{props.success}</div>
        )}
        {props.error && (
          <div class="alert error">{props.error}</div>
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

            <button type="submit" class="btn primary">保存</button>
          </form>
        </div>

        {(settings.announcementMarkdown && settings.enabled) ? (
          <div class="card">
            <h4>预览</h4>
            <div id="preview-content"></div>
          </div>
        ) : null}

        <a href="/admin/models">← 返回模型管理</a>
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
