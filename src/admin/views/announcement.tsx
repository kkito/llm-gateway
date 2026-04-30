import { FC } from 'hono/jsx';
import { TopbarNav } from '../components/TopbarNav.js';
import type { UiSettings } from '../../config.js';

interface Props {
  settings?: UiSettings;
  error?: string;
  success?: string;
}

export const AnnouncementPage: FC<Props> = (props) => {
  const settings = props.settings || { enabled: false, announcementMarkdown: '' };

  const menuItems = [
    { href: '/admin/models', label: '模型' },
    { href: '/admin/users', label: '用户' },
    { href: '/admin/api-keys', label: 'API Keys' },
    { href: '/admin/model-groups', label: '模型组' },
    { href: '/admin/stats', label: '统计' },
    { href: '/admin/announcement', label: '公告管理' },
    { href: '/admin/password', label: '密码设置' },
    { href: '/admin/privacy', label: '隐私保护' },
  ];

  return (
    <html lang="zh-CN">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>公告管理 - LLM Gateway</title>
        <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
        <style>{`
          :root { --bg-page: #f8f9fb; --bg-card: #ffffff; --text-primary: #1a1d26; --text-secondary: #646a7e; --accent-color: hsl(245 80% 58%); --border-color: #e5e7eb; }
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: system-ui, -apple-system, sans-serif; background: var(--bg-page); color: var(--text-primary); line-height: 1.6; }
          .card { background: var(--bg-card); border-radius: 12px; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.04); margin-bottom: 1rem; }
          .form-group { margin-bottom: 1rem; }
          .form-group label { display: block; font-weight: 600; margin-bottom: 0.4rem; }
          .form-group textarea { width: 100%; min-height: 220px; padding: 0.6rem 0.8rem; border: 1px solid var(--border-color); border-radius: 8px; font-family: 'SF Mono', 'Monaco', monospace; font-size: 0.85rem; line-height: 1.5; resize: vertical; }
          .checkbox-label { display: flex; align-items: center; gap: 0.5rem; font-weight: 600; cursor: pointer; }
          .checkbox-label input[type="checkbox"] { width: 1.25rem; height: 1.25rem; }
          .btn { display: inline-block; padding: 0.6rem 1.5rem; background: var(--accent-color); color: #fff; border: none; border-radius: 8px; font-size: 0.95rem; font-weight: 600; cursor: pointer; }
          .error-banner { background: #fef2f2; color: #991b1b; padding: 0.75rem 1rem; border-radius: 8px; margin-bottom: 1rem; }
          .success-banner { background: #f0fdf4; color: #166534; padding: 0.75rem 1rem; border-radius: 8px; margin-bottom: 1rem; }
          .preview-section { margin-top: 1rem; }
          .preview-section h3 { font-size: 1rem; font-weight: 600; margin-bottom: 0.75rem; color: var(--text-secondary); }
          .preview-content { background: var(--bg-page); border: 1px solid var(--border-color); border-radius: 8px; padding: 1rem; min-height: 60px; }
          .preview-content h1, .preview-content h2, .preview-content h3 { margin-top: 0; }
          .preview-content p { margin-bottom: 0.5rem; }
          .preview-content code { background: rgba(0,0,0,0.05); padding: 0.1rem 0.3rem; border-radius: 4px; font-size: 0.85rem; }
          .preview-content pre { background: rgba(0,0,0,0.05); padding: 0.75rem; border-radius: 8px; overflow-x: auto; }
          .preview-content pre code { background: none; padding: 0; }
          .form-hint { font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 1rem; }
        `}</style>
      </head>
      <body>
        <TopbarNav title="公告管理" activePath="/admin/announcement" menuItems={menuItems}>
          <h1 style="font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem;">公告管理</h1>
          <p class="form-hint">编辑将在前台首页顶部显示的公告内容（支持 Markdown 格式）</p>

          {props.error && <div class="error-banner">{props.error}</div>}
          {props.success && <div class="success-banner">{props.success}</div>}

          <div class="card">
            <form method="post" action="/admin/announcement">
              <div class="form-group">
                <label class="checkbox-label">
                  <input type="hidden" name="enabled" value="off" />
                  <input type="checkbox" name="enabled" value="on" checked={settings.enabled} />
                  启用公告
                </label>
              </div>

              <div class="form-group">
                <label>Markdown 内容</label>
                <textarea
                  name="announcementMarkdown"
                  placeholder="# 公告标题&#10;&#10;这里是公告内容，支持 **Markdown** 格式..."
                >{settings.announcementMarkdown || ''}</textarea>
              </div>

              <button type="submit" class="btn">保存</button>
            </form>
          </div>

          {(settings.announcementMarkdown && settings.enabled) ? (
            <div class="card preview-section">
              <h3>预览</h3>
              <div class="preview-content" id="preview-content"></div>
            </div>
          ) : null}
        </TopbarNav>

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
      </body>
    </html>
  );
};
