import { FC } from 'hono/jsx';
import { TopbarNav } from '../components/TopbarNav.js';

interface PrivacySettings {
  enabled: boolean;
  stripUserField: boolean;
  sanitizeFilePaths: boolean;
  pathPlaceholder: string;
  whitelistFilter: boolean;
}

interface Props {
  settings: PrivacySettings;
  error?: string;
  success?: string;
}

const DEFAULT_PLACEHOLDER = '__USER__';

export const PrivacySettingsPage: FC<Props> = (props) => {
  const s = props.settings;

  const menuItems = [
    { href: '/admin/models', label: '模型' },
    { href: '/admin/users', label: '用户' },
    { href: '/admin/api-keys', label: 'API Keys' },
    { href: '/admin/model-groups', label: '模型组' },
    { href: '/admin/stats', label: '统计' },
    { href: '/admin/password', label: '密码设置' },
    { href: '/admin/privacy', label: '隐私保护' },
  ];

  return (
    <html lang="zh-CN">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>隐私保护 - LLM Gateway</title>
        <style>{`
          :root { --bg-page: #f8f9fb; --bg-card: #ffffff; --text-primary: #1a1d26; --text-secondary: #646a7e; --accent-color: hsl(245 80% 58%); --border-color: #e5e7eb; }
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: system-ui, -apple-system, sans-serif; background: var(--bg-page); color: var(--text-primary); line-height: 1.6; }
          .card { background: var(--bg-card); border-radius: 12px; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.04); margin-bottom: 1rem; }
          .toggle-row { display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 0; border-bottom: 1px solid var(--border-color); }
          .toggle-row:last-child { border-bottom: none; }
          .toggle-label { font-weight: 500; }
          .toggle-desc { font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.25rem; }
          .toggle-row input[type="checkbox"] { width: 1.25rem; height: 1.25rem; }
          .toggle-row input[type="text"] { width: 12rem; padding: 0.35rem 0.6rem; border: 1px solid var(--border-color); border-radius: 6px; }
          .btn { display: inline-block; padding: 0.6rem 1.5rem; background: var(--accent-color); color: #fff; border: none; border-radius: 8px; font-size: 0.95rem; font-weight: 600; cursor: pointer; }
          .error-banner { background: #fef2f2; color: #991b1b; padding: 0.75rem 1rem; border-radius: 8px; margin-bottom: 1rem; }
          .success-banner { background: #f0fdf4; color: #166534; padding: 0.75rem 1rem; border-radius: 8px; margin-bottom: 1rem; }
          .whitelist-info { font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.5rem; }
        `}</style>
      </head>
      <body>
        <TopbarNav title="隐私保护" activePath="/admin/privacy" menuItems={menuItems}>
          <h1 style="font-size: 1.5rem; font-weight: 700; margin-bottom: 1.5rem;">隐私保护设置</h1>

          {props.error && <div class="error-banner">{props.error}</div>}
          {props.success && <div class="success-banner">{props.success}</div>}

          <div class="card">
            <form method="post" action="/admin/privacy">
              <div class="toggle-row">
                <div>
                  <div class="toggle-label">启用隐私保护</div>
                  <div class="toggle-desc">总开关，关闭时所有子功能不生效</div>
                </div>
                <input type="hidden" name="enabled" value="off" />
                <input type="checkbox" name="enabled" value="on" checked={s.enabled} />
              </div>

              <div class="toggle-row" style={!s.enabled ? 'opacity: 0.5; pointer-events: none;' : ''}>
                <div>
                  <div class="toggle-label">抹掉 user 字段</div>
                  <div class="toggle-desc">删除请求中的 OpenAI user 字段（端点用户追踪）</div>
                </div>
                <input type="hidden" name="stripUserField" value="off" />
                <input type="checkbox" name="stripUserField" value="on" checked={s.stripUserField} disabled={!s.enabled} />
              </div>

              <div class="toggle-row" style={!s.enabled ? 'opacity: 0.5; pointer-events: none;' : ''}>
                <div>
                  <div class="toggle-label">文件路径用户名替换</div>
                  <div class="toggle-desc">将 /home/xxx/、/Users/xxx/ 等路径中的用户名替换为占位符</div>
                </div>
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                  <input type="text" name="pathPlaceholder" value={s.pathPlaceholder || DEFAULT_PLACEHOLDER} placeholder="__USER__" disabled={!s.enabled} />
                  <input type="hidden" name="sanitizeFilePaths" value="off" />
                  <input type="checkbox" name="sanitizeFilePaths" value="on" checked={s.sanitizeFilePaths} disabled={!s.enabled} />
                </div>
              </div>

              <div class="toggle-row" style={!s.enabled ? 'opacity: 0.5; pointer-events: none;' : ''}>
                <div>
                  <div class="toggle-label">白名单字段过滤</div>
                  <div class="toggle-desc">只转发已知安全字段，过滤掉 user、metadata、extra_body 等</div>
                  <div class="whitelist-info">安全字段: messages, stream, temperature, max_tokens, top_p, presence_penalty, frequency_penalty, stop, response_format, tools, tool_choice, seed, stream_options</div>
                </div>
                <input type="hidden" name="whitelistFilter" value="off" />
                <input type="checkbox" name="whitelistFilter" value="on" checked={s.whitelistFilter} disabled={!s.enabled} />
              </div>

              <div style="margin-top: 1.5rem;">
                <button type="submit" class="btn">保存设置</button>
              </div>
            </form>
          </div>
        </TopbarNav>
      </body>
    </html>
  );
};
