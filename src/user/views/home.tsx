import { FC } from 'hono/jsx';
import { Layout } from '../components/Layout.js';
import type { ProviderConfig } from '../../config.js';

interface Props {
  models: ProviderConfig[];
}

export const HomePage: FC<Props> = (props) => {
  const uniqueBaseUrls = Array.from(new Set(props.models.map((m) => m.baseUrl)));
  const firstModel = props.models.length > 0 ? props.models[0].customModel : '';

  return (
    <Layout title="配置信息">
      <div style={{ marginBottom: '2rem' }}>
        <p style={{ fontSize: '1rem', lineHeight: '1.6' }}>
          🎉 本站提供公司内部免费的大模型 API 服务，欢迎大家将个人购买的大模型服务贡献出来，
          <span style={{ color: '#dc3545', fontSize: '0.9rem' }}>（账号被封概不负责）</span>
        </p>
      </div>

      <h1>📍 当前服务配置</h1>

      <section>
        <h2>Base URL</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', maxWidth: '500px' }}>
          <p id="base-url-display" style={{ fontSize: '1.1rem', margin: 0, flex: 1 }}>
            正在读取...
          </p>
          <button
            id="copy-base-url"
            style={{ padding: '0.5rem 1rem', fontSize: '1rem', cursor: 'pointer' }}
          >
            复制
          </button>
        </div>
      </section>

      <section>
        <h2>🤖 Model（{props.models.length} 个可选）</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', maxWidth: '500px' }}>
          <select
            id="model-select"
            style={{ width: '100%', maxWidth: '400px', padding: '0.5rem', fontSize: '1rem' }}
            value={firstModel}
          >
            {props.models.map((model) => (
              <option key={model.customModel} value={model.customModel}>
                {model.customModel}
              </option>
            ))}
          </select>
          <button
            id="copy-model"
            style={{ padding: '0.5rem 1rem', fontSize: '1rem', cursor: 'pointer' }}
          >
            复制
          </button>
        </div>
        <div id="model-desc-container" style={{ marginTop: '0.5rem', maxWidth: '500px' }}>
          <p id="model-desc" style={{ fontSize: '0.9rem', color: '#6b7280', margin: 0, lineHeight: '1.5' }}>
          </p>
        </div>
      </section>

      <section>
        <h2>🔑 API Key</h2>
        <p style={{ fontSize: '1.1rem', color: '#059669', backgroundColor: '#d1fae5', padding: '1rem', borderRadius: '0.5rem' }}>
          ✅ 不需要，随便填即可
        </p>
      </section>

      <section style={{ marginTop: '3rem', paddingTop: '2rem', borderTop: '1px solid #e5e7eb' }}>
        <h3 style={{ color: '#6b7280', fontSize: '0.9rem', marginBottom: '1rem' }}>
          💡 常用 Coding Agent 配置参考：
          Claude Code / Cursor / OpenCode / Qwen Code 等配置方式请参考
          <a href="https://cloud.baidu.com/doc/qianfan/s/0mn2mnemj" target="_blank" rel="noopener" style={{ color: '#6b7280', textDecoration: 'underline' }}>
            百度千帆文档
          </a>
          或
          <a href="https://help.aliyun.com/zh/model-studio/qwen-code-coding-plan" target="_blank" rel="noopener" style={{ color: '#6b7280', textDecoration: 'underline' }}>
            阿里云百炼文档
          </a>
        </h3>

        <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: '#f9fafb', borderRadius: '0.5rem' }}>
          <p style={{ color: '#6b7280', fontSize: '0.85rem', margin: '0.5rem 0', lineHeight: '1.6' }}>
            🔌 <strong>格式兼容：</strong>本站兼容 OpenAI / Anthropic 两种格式，其他未支持的格式可通过这两种格式兼容使用。
          </p>
          <p style={{ color: '#6b7280', fontSize: '0.85rem', margin: '0.5rem 0', lineHeight: '1.6' }}>
            ⚡ <strong>Cache Token 加速：</strong>支持 Cache Token 加速 Coding Agent 实现。Qwen Code 可直接使用
            <code style={{ backgroundColor: '#e5e7eb', padding: '0.2rem 0.4rem', borderRadius: '0.25rem', margin: '0 0.25rem' }}>
              http://dashscope.aliyuncs.com.llm.macmini.kkito.cn/
            </code>
            访问实现 Cache Token，加快速度。
          </p>
        </div>
      </section>

      <script
        dangerouslySetInnerHTML={{
          __html: `
            (function() {
              // 模型描述数据
              var modelDescs = ${JSON.stringify(props.models.reduce((acc, m) => {
                acc[m.customModel] = m.desc || '';
                return acc;
              }, {} as Record<string, string>))};

              var baseUrl = window.location.origin;
              document.getElementById('base-url-display').textContent = baseUrl;

              // 初始化显示第一个模型的 desc
              var firstModel = ${JSON.stringify(firstModel)};
              updateModelDesc(firstModel);

              function updateModelDesc(modelName) {
                var desc = modelDescs[modelName] || '';
                var descElement = document.getElementById('model-desc');
                var descContainer = document.getElementById('model-desc-container');
                if (desc) {
                  descElement.textContent = desc;
                  descContainer.style.display = 'block';
                } else {
                  descElement.textContent = '';
                  descContainer.style.display = 'none';
                }
              }

              function showToast(message) {
                var toast = document.createElement('div');
                toast.textContent = message;
                toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#10b981;color:white;padding:12px 24px;border-radius:8px;font-size:14px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.15);';
                document.body.appendChild(toast);
                setTimeout(function() {
                  document.body.removeChild(toast);
                }, 2000);
              }

              function copyToClipboard(text, callback) {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                  navigator.clipboard.writeText(text).then(function() {
                    callback(true);
                  }).catch(function() {
                    callback(false);
                  });
                } else {
                  // 降级方案：使用 execCommand
                  var textarea = document.createElement('textarea');
                  textarea.value = text;
                  textarea.style.position = 'fixed';
                  textarea.style.opacity = '0';
                  textarea.style.left = '-9999px';
                  document.body.appendChild(textarea);
                  textarea.select();
                  try {
                    var success = document.execCommand('copy');
                    document.body.removeChild(textarea);
                    callback(success);
                  } catch (e) {
                    document.body.removeChild(textarea);
                    callback(false);
                  }
                }
              }

              document.getElementById('model-select').addEventListener('change', function(e) {
                updateModelDesc(e.target.value);
              });

              document.getElementById('copy-base-url').addEventListener('click', function() {
                var text = document.getElementById('base-url-display').textContent;
                copyToClipboard(text, function(success) {
                  showToast(success ? 'Base URL 已复制' : '复制失败');
                });
              });

              document.getElementById('copy-model').addEventListener('click', function() {
                var select = document.getElementById('model-select');
                var text = select.value;
                copyToClipboard(text, function(success) {
                  showToast(success ? 'Model 已复制' : '复制失败');
                });
              });
            })();
          `
        }}
      />
    </Layout>
  );
};
