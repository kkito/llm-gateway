import { FC } from 'hono/jsx';
import { Layout } from '../components/Layout.js';
import type { ProviderConfig } from '../../config.js';

interface Props {
  models: ProviderConfig[];
  userName?: string;
}

export const HomePage: FC<Props> = (props) => {
  const firstModel = props.models.length > 0 ? props.models[0].customModel : '';
  const userName = props.userName || '访客';

  return (
    <Layout title="LLM Gateway - 配置信息">
      {/* 全局样式 */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            :root {
              --primary: #6366f1;
              --primary-hover: #4f46e5;
              --success: #10b981;
              --success-bg: #d1fae5;
              --warning-bg: #fef3c7;
              --card-bg: #ffffff;
              --text-primary: #1f2937;
              --text-secondary: #6b7280;
              --border: #e5e7eb;
              --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
              --shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
              --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
              --radius: 12px;
              --radius-sm: 8px;
            }

            * {
              box-sizing: border-box;
            }

            body {
              background: linear-gradient(135deg, #f8fafc 0%, #eef2ff 100%);
              min-height: 100vh;
              padding-bottom: 1.5rem;
            }

            .container {
              max-width: 650px;
              margin: 0 auto;
              padding: 0.75rem;
            }

            /* Hero 区域 */
            .hero {
              text-align: center;
              padding: 0.75rem 0 0.5rem;
              margin-bottom: 0.75rem;
            }

            .hero h1 {
              font-size: 1.25rem;
              font-weight: 700;
              color: var(--text-primary);
              margin: 0 0 0.35rem 0;
              background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
              -webkit-background-clip: text;
              -webkit-text-fill-color: transparent;
              background-clip: text;
            }

            .hero-subtitle {
              font-size: 0.8rem;
              color: var(--text-secondary);
              margin: 0;
              line-height: 1.4;
            }

            .hero-notice {
              display: inline-block;
              margin-top: 0.5rem;
              padding: 0.3rem 0.6rem;
              background: var(--warning-bg);
              border-radius: var(--radius-sm);
              font-size: 0.7rem;
              color: #92400e;
            }

            .hero-notice strong {
              color: #dc2626;
            }

            /* 卡片样式 */
            .card {
              background: var(--card-bg);
              border-radius: var(--radius);
              box-shadow: var(--shadow);
              padding: 0.6rem 0.85rem;
              margin-bottom: 0.5rem;
              transition: all 0.3s ease;
              border: 1px solid var(--border);
            }

            .card:hover {
              box-shadow: var(--shadow-lg);
              transform: translateY(-2px);
            }

            .card-header {
              display: flex;
              align-items: center;
              gap: 0.4rem;
              margin-bottom: 0.5rem;
            }

            .card-header h2 {
              font-size: 0.85rem;
              font-weight: 600;
              color: var(--text-primary);
              margin: 0;
            }

            .card-icon {
              font-size: 1.1rem;
            }

            .model-count {
              font-size: 0.75rem;
              color: var(--text-secondary);
              font-weight: 400;
            }

            /* 输入框和选择器 */
            .input-wrapper {
              display: flex;
              align-items: center;
              gap: 0.4rem;
              background: #f9fafb;
              border: 1px solid var(--border);
              border-radius: var(--radius-sm);
              padding: 0.25rem;
              transition: border-color 0.2s ease;
            }

            .input-wrapper:focus-within {
              border-color: var(--primary);
              box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
            }

            .input-value {
              flex: 1;
              font-size: 0.8rem;
              color: var(--text-primary);
              padding: 0.3rem 0.4rem;
              background: transparent;
              border: none;
              outline: none;
              font-family: 'SF Mono', 'Monaco', 'Inconsolata', monospace;
            }

            .input-value[readonly] {
              cursor: default;
            }

            select.input-value {
              cursor: pointer;
              font-family: inherit;
            }

            select.input-value option {
              font-family: inherit;
            }

            /* 复制按钮 */
            .copy-btn {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              gap: 0.3rem;
              padding: 0.3rem 0.5rem;
              font-size: 0.75rem;
              font-weight: 500;
              color: white;
              background: linear-gradient(135deg, var(--primary) 0%, var(--primary-hover) 100%);
              border: none;
              border-radius: var(--radius-sm);
              cursor: pointer;
              transition: all 0.2s ease;
              white-space: nowrap;
            }

            .copy-btn:hover {
              transform: scale(1.05);
              box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
            }

            .copy-btn:active {
              transform: scale(0.98);
            }

            .copy-btn svg {
              width: 12px;
              height: 12px;
            }

            /* 模型描述 */
            .model-desc {
              margin-top: 0.35rem;
              padding: 0.35rem 0.6rem;
              background: #f8fafc;
              border-left: 2px solid var(--primary);
              border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
              font-size: 0.75rem;
              color: var(--text-secondary);
              line-height: 1.4;
              display: none;
            }

            .model-desc.visible {
              display: block;
              animation: fadeIn 0.3s ease;
            }

            /* API Key 成功提示 */
            .api-key-success {
              display: flex;
              align-items: center;
              gap: 0.4rem;
              padding: 0.5rem 0.75rem;
              background: var(--success-bg);
              border-radius: var(--radius-sm);
              font-size: 0.8rem;
              color: #065f46;
              font-weight: 500;
            }

            .api-key-success .check-icon {
              font-size: 1rem;
            }

            /* 参考信息区域 */
            .reference-section {
              margin-top: 1rem;
              padding-top: 0.75rem;
              border-top: 1px solid var(--border);
            }

            .reference-title {
              font-size: 0.8rem;
              font-weight: 600;
              color: var(--text-primary);
              margin-bottom: 0.5rem;
              display: flex;
              align-items: center;
              gap: 0.4rem;
            }

            .reference-card {
              background: linear-gradient(135deg, #f9fafb 0%, #f3f4f6 100%);
              border-radius: var(--radius);
              padding: 0.75rem;
              border: 1px solid var(--border);
            }

            .reference-item {
              font-size: 0.75rem;
              color: var(--text-secondary);
              line-height: 1.6;
              margin: 0.3rem 0;
            }

            .reference-item strong {
              color: var(--text-primary);
            }

            .reference-item code {
              display: inline-block;
              background: #eef2ff;
              color: var(--primary);
              padding: 0.15rem 0.3rem;
              border-radius: 4px;
              font-family: 'SF Mono', 'Monaco', 'Inconsolata', monospace;
              font-size: 0.7rem;
              margin: 0.15rem 0;
              word-break: break-all;
            }

            .reference-link {
              color: var(--primary);
              text-decoration: none;
              border-bottom: 1px solid transparent;
              transition: border-color 0.2s ease;
            }

            .reference-link:hover {
              border-bottom-color: var(--primary);
            }

            /* Toast 提示 */
            .toast {
              position: fixed;
              top: 0.75rem;
              left: 50%;
              transform: translateX(-50%) translateY(-100%);
              background: #1f2937;
              color: white;
              padding: 0.5rem 1rem;
              border-radius: var(--radius-sm);
              font-size: 0.75rem;
              font-weight: 500;
              box-shadow: var(--shadow-lg);
              opacity: 0;
              z-index: 9999;
              transition: all 0.3s ease;
            }

            .toast.show {
              transform: translateX(-50%) translateY(0);
              opacity: 1;
            }

            .toast.success {
              background: var(--success);
            }

            .toast.error {
              background: #dc2626;
            }

            /* 动画 */
            @keyframes fadeIn {
              from {
                opacity: 0;
                transform: translateY(-8px);
              }
              to {
                opacity: 1;
                transform: translateY(0);
              }
            }

            @keyframes slideDown {
              from {
                opacity: 0;
                transform: translateY(-20px);
              }
              to {
                opacity: 1;
                transform: translateY(0);
              }
            }

            .hero {
              animation: slideDown 0.5s ease;
            }

            /* 响应式 */
            @media (max-width: 640px) {
              .container {
                padding: 0.5rem;
              }

              .hero h1 {
                font-size: 1.1rem;
              }

              .hero-subtitle {
                font-size: 0.75rem;
              }

              .hero-notice {
                font-size: 0.65rem;
                padding: 0.25rem 0.5rem;
              }

              .input-wrapper {
                flex-wrap: wrap;
              }

              .input-value {
                width: 100%;
                min-width: 0;
              }

              .copy-btn {
                width: 100%;
                justify-content: center;
              }
            }
          `
        }}
      />

      {/* Hero 区域 */}
      <div class="hero">
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem'}}>
          <div>
            <h1>🚀 LLM Gateway</h1>
            <p class="hero-subtitle">
              公司内部免费大模型 API · 支持 OpenAI / Anthropic 格式
            </p>
          </div>
          <div style={{textAlign: 'right'}}>
            <p style={{margin: '0', fontSize: '0.85rem', color: 'var(--text-secondary)'}}>
              欢迎，<strong style={{color: 'var(--primary)'}}>{userName}</strong>
            </p>
            <div style={{marginTop: '0.5rem'}}>
              <a href="/user/stats" style={{color: 'var(--primary)', textDecoration: 'none', marginRight: '0.75rem', fontSize: '0.8rem'}}>统计</a>
              <a href="/user/logout" style={{color: 'var(--primary)', textDecoration: 'none', fontSize: '0.8rem'}}>登出</a>
            </div>
          </div>
        </div>
        <div class="hero-notice">
          欢迎贡献 · <strong>账号被封概不负责</strong>
        </div>
      </div>

      {/* Base URL 卡片 */}
      <div class="card">
        <div class="card-header">
          <span class="card-icon">🌐</span>
          <h2>Base URL</h2>
        </div>
        <div class="input-wrapper">
          <input
            type="text"
            id="base-url-display"
            class="input-value"
            readonly
            value="正在读取..."
          />
          <button id="copy-base-url" class="copy-btn">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            复制
          </button>
        </div>
      </div>

      {/* Model 卡片 */}
      <div class="card">
        <div class="card-header">
          <span class="card-icon">🤖</span>
          <h2>
            Model
            <span class="model-count">（{props.models.length} 个可选）</span>
          </h2>
        </div>
        <div class="input-wrapper">
          <select
            id="model-select"
            class="input-value"
            value={firstModel}
          >
            {props.models.map((model) => (
              <option key={model.customModel} value={model.customModel}>
                {model.customModel}
              </option>
            ))}
          </select>
          <button id="copy-model" class="copy-btn">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            复制
          </button>
        </div>
        <div id="model-desc" class="model-desc"></div>
      </div>

      {/* API Key 卡片 */}
      <div class="card">
        <div class="card-header">
          <span class="card-icon">🔑</span>
          <h2>API Key</h2>
        </div>
        <div class="api-key-success">
          <span class="check-icon">✅</span>
          <span>不需要，随便填即可</span>
        </div>
      </div>

      {/* 参考信息区域 */}
      <div class="reference-section">
        <h3 class="reference-title">
          💡 常用 Coding Agent 配置
        </h3>
        <div class="reference-card">
          <p class="reference-item">
            <strong>Claude Code / Cursor / OpenCode / Qwen Code 等配置参考：</strong>
            <a href="https://cloud.baidu.com/doc/qianfan/s/0mn2mnemj" target="_blank" rel="noopener" class="reference-link">
              百度千帆文档
            </a>
            {' '}或{' '}
            <a href="https://help.aliyun.com/zh/model-studio/qwen-code-coding-plan" target="_blank" rel="noopener" class="reference-link">
              阿里云百炼文档
            </a>
          </p>
          <p class="reference-item">
            <strong>🔌 格式兼容：</strong>
            本站兼容 OpenAI / Anthropic 两种格式，其他未支持的格式可通过这两种格式兼容使用。
          </p>
          <p class="reference-item">
            <strong>⚡ Cache Token 加速：</strong>
            支持 Cache Token 加速 Coding Agent 实现。Qwen Code 可直接使用以下地址访问实现 Cache Token，加快速度：
            <br />
            <code id="cache-token-url">http://dashscope.aliyuncs.com.llm.macmini.kkito.cn/</code>
          </p>
        </div>
      </div>

      {/* Toast 容器 */}
      <div id="toast" class="toast"></div>

      {/* JavaScript 逻辑 */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
            (function() {
              // 模型描述数据
              var modelDescs = ${JSON.stringify(props.models.reduce((acc, m) => {
                acc[m.customModel] = m.desc || '';
                return acc;
              }, {} as Record<string, string>))};

              // 初始化 Base URL
              var baseUrl = window.location.origin;
              document.getElementById('base-url-display').value = baseUrl;

              // 初始化模型描述
              var firstModel = ${JSON.stringify(firstModel)};
              updateModelDesc(firstModel);

              // 更新模型描述
              function updateModelDesc(modelName) {
                var desc = modelDescs[modelName] || '';
                var descElement = document.getElementById('model-desc');
                if (desc) {
                  descElement.textContent = desc;
                  descElement.classList.add('visible');
                } else {
                  descElement.textContent = '';
                  descElement.classList.remove('visible');
                }
              }

              // Toast 提示
              function showToast(message, type) {
                var toast = document.getElementById('toast');
                toast.textContent = message;
                toast.className = 'toast show ' + (type || '');
                
                setTimeout(function() {
                  toast.classList.remove('show');
                }, 2000);
              }

              // 复制功能
              function copyToClipboard(text, callback) {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                  navigator.clipboard.writeText(text).then(function() {
                    callback(true);
                  }).catch(function() {
                    callback(false);
                  });
                } else {
                  // 降级方案
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

              // 事件绑定
              document.getElementById('model-select').addEventListener('change', function(e) {
                updateModelDesc(e.target.value);
              });

              document.getElementById('copy-base-url').addEventListener('click', function() {
                var text = document.getElementById('base-url-display').value;
                copyToClipboard(text, function(success) {
                  showToast(success ? '✅ Base URL 已复制' : '❌ 复制失败', success ? 'success' : 'error');
                });
              });

              document.getElementById('copy-model').addEventListener('click', function() {
                var select = document.getElementById('model-select');
                var text = select.value;
                copyToClipboard(text, function(success) {
                  showToast(success ? '✅ Model 已复制' : '❌ 复制失败', success ? 'success' : 'error');
                });
              });
            })();
          `
        }}
      />
    </Layout>
  );
};
