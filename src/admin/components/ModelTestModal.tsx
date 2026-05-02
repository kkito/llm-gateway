import { FC } from 'hono/jsx';

interface ModelConfig {
  customModel: string;
  realModel: string;
  baseUrl: string;
  provider: string;
  apiKey?: string;
  apiKeyId?: string;
}

interface ModelTestModalProps {
  isOpen: boolean;
  onClose: () => void;
  modelConfig: ModelConfig;
}

export const ModelTestModal: FC<ModelTestModalProps> = (props) => {
  const { isOpen, onClose, modelConfig } = props;

  if (!isOpen) {
    return null;
  }

  return (
    <>
      <div id="modelTestModalBackdrop" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:999;" onclick="window.closeModelTestModal()" />
      <div id="modelTestModal" style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--bg-card);border-radius:var(--radius);box-shadow:var(--shadow-lg);z-index:1000;width:90%;max-width:720px;max-height:90vh;overflow-y:auto;">
        {/* Header */}
        <div style="display:flex;align-items:center;justify-content:space-between;padding:1.25rem 1.5rem;border-bottom:1px solid var(--border-color);">
          <h2 style="margin:0;font-size:1.2rem;font-weight:700;color:var(--text-primary);">测试模型</h2>
          <button type="button" style="width:32px;height:32px;border:none;background:transparent;cursor:pointer;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.2rem;color:var(--text-secondary);" onclick="window.closeModelTestModal()" title="关闭">×</button>
        </div>

        {/* Body */}
        <div style="padding:1.5rem;">
          {/* Model Info */}
          <div style="margin-bottom:1.25rem;padding:1rem;background:var(--bg-page);border-radius:var(--radius-sm);border:1px solid var(--border-color);">
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:0.75rem;font-size:0.88rem;">
              <div>
                <span style="color:var(--text-secondary);display:block;font-size:0.8rem;margin-bottom:0.2rem;">自定义名称</span>
                <span style="font-weight:600;color:var(--text-primary);" id="modalCustomModel">{modelConfig.customModel}</span>
              </div>
              <div>
                <span style="color:var(--text-secondary);display:block;font-size:0.8rem;margin-bottom:0.2rem;">实际模型</span>
                <span style="font-weight:600;color:var(--text-primary);" id="modalRealModel">{modelConfig.realModel}</span>
              </div>
              <div>
                <span style="color:var(--text-secondary);display:block;font-size:0.8rem;margin-bottom:0.2rem;">Provider</span>
                <span style="color:var(--text-primary);" id="modalProvider">{modelConfig.provider}</span>
              </div>
              <div>
                <span style="color:var(--text-secondary);display:block;font-size:0.8rem;margin-bottom:0.2rem;">Base URL</span>
                <span style="color:var(--text-primary);font-size:0.82rem;word-break:break-all;" id="modalBaseUrl">{modelConfig.baseUrl}</span>
              </div>
            </div>
          </div>

          {/* Test Message Input */}
          <div style="margin-bottom:1.25rem;">
            <label for="modalTestMessage" style="display:block;font-size:0.88rem;font-weight:600;color:var(--text-primary);margin-bottom:0.5rem;">测试消息</label>
            <textarea id="modalTestMessage" rows={3} style="width:100%;padding:0.75rem;border:1px solid var(--border-color);border-radius:var(--radius-sm);font-size:0.9rem;font-family:inherit;resize:vertical;background:var(--bg-card);color:var(--text-primary);" placeholder="输入测试消息...">请介绍一下你自己</textarea>
          </div>

          {/* Send Button */}
          <button id="modalTestBtn" type="button" onclick="window.runModelTest()" style="width:100%;padding:0.75rem;border:none;border-radius:var(--radius-sm);background:var(--accent-gradient);color:#fff;font-size:0.95rem;font-weight:600;cursor:pointer;box-shadow:0 4px 14px hsl(245 75% 58% / 0.35);">发送</button>

          {/* Loading State */}
          <div id="modalTestLoading" style="display:none;text-align:center;padding:1.5rem 0;color:var(--text-secondary);">
            <div style="display:inline-block;width:20px;height:20px;border:2px solid var(--border-color);border-top-color:var(--accent-color);border-radius:50%;animation:spin 0.8s linear infinite;"></div>
            <div style="margin-top:0.5rem;font-size:0.9rem;">请求中...</div>
          </div>

          {/* Metrics Display */}
          <div id="modalMetrics" style="display:none;margin-top:1.25rem;">
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.75rem;">
              <div class="metric-card" style="padding:0.85rem;background:var(--bg-page);border-radius:var(--radius-sm);border:1px solid var(--border-color);text-align:center;">
                <div style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:0.3rem;">总耗时</div>
                <div id="metricTotalTime" style="font-size:1.1rem;font-weight:700;color:var(--text-primary);">—</div>
              </div>
              <div class="metric-card" style="padding:0.85rem;background:var(--bg-page);border-radius:var(--radius-sm);border:1px solid var(--border-color);text-align:center;">
                <div style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:0.3rem;">Token 总量</div>
                <div id="metricTotalTokens" style="font-size:1.1rem;font-weight:700;color:var(--text-primary);">—</div>
              </div>
              <div class="metric-card" style="padding:0.85rem;background:var(--bg-page);border-radius:var(--radius-sm);border:1px solid var(--border-color);text-align:center;">
                <div style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:0.3rem;">Prompt Tokens</div>
                <div id="metricPromptTokens" style="font-size:1.1rem;font-weight:700;color:var(--text-primary);">—</div>
              </div>
              <div class="metric-card" style="padding:0.85rem;background:var(--bg-page);border-radius:var(--radius-sm);border:1px solid var(--border-color);text-align:center;">
                <div style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:0.3rem;">Completion Tokens</div>
                <div id="metricCompletionTokens" style="font-size:1.1rem;font-weight:700;color:var(--text-primary);">—</div>
              </div>
              <div class="metric-card" style="padding:0.85rem;background:var(--bg-page);border-radius:var(--radius-sm);border:1px solid var(--border-color);text-align:center;">
                <div style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:0.3rem;">生成速度</div>
                <div id="metricSpeed" style="font-size:1.1rem;font-weight:700;color:var(--text-primary);">—</div>
              </div>
            </div>
          </div>

          {/* Error Display */}
          <div id="modalError" style="display:none;margin-top:1.25rem;padding:1rem;background:var(--danger-bg);border:1px solid #fecaca;border-radius:var(--radius-sm);color:var(--danger-color);font-size:0.9rem;">
            <div id="modalErrorMessage"></div>
          </div>

          {/* Content Display */}
          <div id="modalContent" style="display:none;margin-top:1.25rem;">
            <label style="display:block;font-size:0.88rem;font-weight:600;color:var(--text-primary);margin-bottom:0.5rem;">响应内容</label>
            <pre id="modalContentText" style="max-height:300px;overflow-y:auto;padding:1rem;background:var(--bg-page);border:1px solid var(--border-color);border-radius:var(--radius-sm);font-size:0.85rem;line-height:1.6;white-space:pre-wrap;color:var(--text-primary);margin:0;"></pre>
          </div>

          {/* Raw Response Section */}
          <div id="modalRawResponse" style="display:none;margin-top:1.25rem;">
            <a id="modalRawToggle" href="javascript:void(0)" onclick="window.toggleModalRawResponse()" style="font-size:0.85rem;color:var(--accent-color);text-decoration:none;display:inline-flex;align-items:center;gap:0.3rem;">
              <span id="modalRawToggleIcon">▼</span> 查看原始响应
            </a>
            <pre id="modalRawJson" style="display:none;max-height:250px;overflow-y:auto;padding:0.85rem;background:var(--bg-page);border:1px solid var(--border-color);border-radius:var(--radius-sm);font-size:0.8rem;line-height:1.5;white-space:pre-wrap;color:var(--text-secondary);margin-top:0.5rem;"></pre>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        @media (max-width: 640px) {
          #modelTestModal {
            width: 95% !important;
            max-width: none !important;
          }
          #modalMetrics > div {
            grid-template-columns: repeat(2, 1fr) !important;
          }
        }
      `}</style>

      <script
        dangerouslySetInnerHTML={{
          __html: `
            (function() {
              window.modelTestModalConfig = ${JSON.stringify(modelConfig)};
              window.modelTestModalStartTime = 0;

              window.closeModelTestModal = function() {
                var backdrop = document.getElementById('modelTestModalBackdrop');
                var modal = document.getElementById('modelTestModal');
                if (backdrop) backdrop.remove();
                if (modal) modal.remove();
              };

              window.runModelTest = function() {
                var btn = document.getElementById('modalTestBtn');
                var loading = document.getElementById('modalTestLoading');
                var metrics = document.getElementById('modalMetrics');
                var error = document.getElementById('modalError');
                var content = document.getElementById('modalContent');
                var rawResponse = document.getElementById('modalRawResponse');
                var message = document.getElementById('modalTestMessage').value || '请介绍一下你自己';

                // Reset states
                btn.disabled = true;
                btn.style.opacity = '0.6';
                btn.textContent = '请求中...';
                loading.style.display = 'block';
                metrics.style.display = 'none';
                error.style.display = 'none';
                content.style.display = 'none';
                rawResponse.style.display = 'none';

                // Reset metric cards
                document.querySelectorAll('.metric-card > div:last-child').forEach(function(el) {
                  el.textContent = '—';
                });

                window.modelTestModalStartTime = Date.now();

                fetch('/admin/models/test', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    provider: window.modelTestModalConfig.provider,
                    baseUrl: window.modelTestModalConfig.baseUrl,
                    apiKey: window.modelTestModalConfig.apiKey || '',
                    apiKeyId: window.modelTestModalConfig.apiKeyId || '',
                    realModel: window.modelTestModalConfig.realModel,
                    message: message
                  })
                })
                .then(function(res) { return res.json(); })
                .then(function(data) {
                  var totalTime = Date.now() - window.modelTestModalStartTime;

                  btn.disabled = false;
                  btn.style.opacity = '1';
                  btn.textContent = '发送';
                  loading.style.display = 'none';

                  if (data.success === false) {
                    // Error state
                    error.style.display = 'block';
                    document.getElementById('modalErrorMessage').textContent = data.message || '请求失败';

                    // Show raw error response
                    rawResponse.style.display = 'block';
                    document.getElementById('modalRawJson').textContent = JSON.stringify(data, null, 2);
                  } else {
                    // Success state - show metrics
                    metrics.style.display = 'block';

                    var usage = data.usage || {};
                    var promptTokens = usage.prompt_tokens || 0;
                    var completionTokens = usage.completion_tokens || 0;
                    var totalTokens = usage.total_tokens || (promptTokens + completionTokens);

                    // Format total time
                    var totalTimeSeconds = (totalTime / 1000).toFixed(2);
                    document.getElementById('metricTotalTime').textContent = totalTimeSeconds + 's';

                    // Set other metrics
                    document.getElementById('metricTotalTokens').textContent = totalTokens;
                    document.getElementById('metricPromptTokens').textContent = promptTokens;
                    document.getElementById('metricCompletionTokens').textContent = completionTokens;

                    // Calculate speed
                    if (completionTokens > 0 && totalTime > 0) {
                      var speed = (completionTokens / (totalTime / 1000)).toFixed(1);
                      document.getElementById('metricSpeed').textContent = speed + ' t/s';
                    } else {
                      document.getElementById('metricSpeed').textContent = '—';
                    }

                    // Show content
                    if (data.content) {
                      content.style.display = 'block';
                      document.getElementById('modalContentText').textContent = data.content;
                    }

                    // Show raw response
                    rawResponse.style.display = 'block';
                    document.getElementById('modalRawJson').textContent = JSON.stringify(data, null, 2);
                  }
                })
                .catch(function(err) {
                  var totalTime = Date.now() - window.modelTestModalStartTime;

                  btn.disabled = false;
                  btn.style.opacity = '1';
                  btn.textContent = '发送';
                  loading.style.display = 'none';

                  error.style.display = 'block';
                  document.getElementById('modalErrorMessage').textContent = '网络错误: ' + err.message;
                });
              };

              window.toggleModalRawResponse = function() {
                var rawJson = document.getElementById('modalRawJson');
                var icon = document.getElementById('modalRawToggleIcon');
                var toggle = document.getElementById('modalRawToggle');

                if (rawJson.style.display === 'none') {
                  rawJson.style.display = 'block';
                  icon.textContent = '▲';
                  toggle.innerHTML = toggle.innerHTML.replace('查看原始响应', '隐藏原始响应');
                } else {
                  rawJson.style.display = 'none';
                  icon.textContent = '▼';
                  toggle.innerHTML = toggle.innerHTML.replace('隐藏原始响应', '查看原始响应');
                }
              };

              // Close on ESC
              document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') {
                  window.closeModelTestModal();
                }
              });
            })();
          `
        }}
      />
    </>
  );
};
