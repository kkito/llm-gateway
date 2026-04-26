import { FC } from 'hono/jsx';

export const ModelTest: FC = () => {
  const jsCode = `
(function() {
  window.runTest = async function() {
    var provider = document.getElementById('provider').value;
    var baseUrl = document.getElementById('baseUrl').value;
    var apiKeySource = document.getElementById('apiKeySource');
    var apiKeyManual = document.getElementById('apiKeyManual');
    var realModel = document.getElementById('realModel').value;
    var message = document.getElementById('testMessage').value;

    // 获取 API Key：手动输入优先，否则用下拉框选择的 ID
    // 如果都为空，让后端从已保存的模型配置中兜底读取
    var apiKey = '';
    var apiKeyId = '';
    if (apiKeyManual && !apiKeyManual.disabled && apiKeyManual.value) {
      apiKey = apiKeyManual.value;
    } else if (apiKeySource && apiKeySource.value !== 'manual') {
      apiKeyId = apiKeySource.value;
    }

    if (!provider || !baseUrl || !realModel) {
      var errEl = document.getElementById('testError');
      document.getElementById('testErrorMessage').textContent = '请先填写 Provider、Base URL、实际模型名称';
      errEl.style.display = 'block';
      document.getElementById('testResult').style.display = 'none';
      return;
    }

    var btn = document.getElementById('testBtn');
    var loading = document.getElementById('testLoading');
    var result = document.getElementById('testResult');
    var error = document.getElementById('testError');

    btn.disabled = true;
    loading.style.display = 'block';
    result.style.display = 'none';
    error.style.display = 'none';
    document.getElementById('rawResponseSection').style.display = 'none';

    try {
      var res = await fetch('/admin/models/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: provider, baseUrl: baseUrl, apiKey: apiKey, apiKeyId: apiKeyId, realModel: realModel, message: message })
      });
      var data = await res.json();

      if (data.success) {
        document.getElementById('testResultModel').textContent = data.model || realModel;
        document.getElementById('testResultContent').textContent = data.content || '(无内容)';
        if (data.usage) {
          document.getElementById('testResultUsage').textContent = 'Tokens: 输入=' + data.usage.prompt_tokens + ', 输出=' + data.usage.completion_tokens;
          document.getElementById('testResultUsage').style.display = 'block';
        } else {
          document.getElementById('testResultUsage').style.display = 'none';
        }
        result.style.display = 'block';
      } else {
        document.getElementById('testErrorMessage').textContent = data.message || '未知错误';
        if (data.rawResponse) {
          document.getElementById('testRawResponse').textContent = data.rawResponse;
          document.getElementById('rawResponseSection').style.display = 'block';
        } else {
          document.getElementById('rawResponseSection').style.display = 'none';
        }
        error.style.display = 'block';
      }
    } catch (e) {
      document.getElementById('testErrorMessage').textContent = '请求失败: ' + e.message;
      document.getElementById('rawResponseSection').style.display = 'none';
      error.style.display = 'block';
    } finally {
      btn.disabled = false;
      loading.style.display = 'none';
    }
  };

  window.toggleRawResponse = function() {
    var section = document.getElementById('rawResponseSection');
    if (section.style.display === 'none') {
      section.style.display = 'block';
    } else {
      section.style.display = 'none';
    }
  };
})();
`.trim();

  return (
    <details style={{ marginTop: '1.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem' }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '1rem', color: 'var(--text-primary)' }}>
        🔍 测试模型配置
      </summary>

      <div style={{ marginTop: '1rem' }}>
        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem' }}>
          测试消息
          <textarea
            id="testMessage"
            style={{
              width: '100%',
              padding: '0.7rem 0.9rem',
              border: '1.5px solid var(--border-color)',
              borderRadius: '8px',
              fontSize: '0.92rem',
              fontFamily: 'inherit',
              background: 'var(--bg-page)',
              minHeight: '80px',
              resize: 'vertical',
            }}
          >
            请介绍一下你自己
          </textarea>
        </label>

        <button
          type="button"
          id="testBtn"
          onclick="runTest()"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            padding: '0.7rem 1.3rem',
            borderRadius: '8px',
            fontSize: '0.88rem',
            fontWeight: 600,
            cursor: 'pointer',
            border: 'none',
            background: 'linear-gradient(135deg, hsl(245 80% 58%) 0%, hsl(268 75% 58%) 100%)',
            color: '#fff',
            boxShadow: '0 4px 14px hsl(245 75% 58% / 0.35)',
          }}
        >
          发送测试请求
        </button>

        <div id="testLoading" style={{ display: 'none', marginTop: '0.75rem', color: 'var(--text-secondary)' }}>
          请求中...
        </div>

        <div id="testResult" style={{ display: 'none', marginTop: '1rem' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            模型: <strong id="testResultModel" />
          </div>
          <pre
            id="testResultContent"
            style={{
              background: 'var(--bg-page)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '1rem',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: '0.88rem',
              lineHeight: '1.6',
            }}
          />
          <div
            id="testResultUsage"
            style={{ display: 'none', marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}
          />
        </div>

        <div id="testError" style={{ display: 'none', marginTop: '1rem' }}>
          <pre
            id="testErrorMessage"
            style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '8px',
              padding: '1rem',
              color: '#ef4444',
              fontSize: '0.88rem',
              whiteSpace: 'pre-wrap',
            }}
          />
          <div id="rawResponseSection" style={{ display: 'none', marginTop: '0.5rem' }}>
            <a
              href="#"
              onclick="event.preventDefault(); toggleRawResponse();"
              style={{ cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-secondary)' }}
            >
              查看原始响应
            </a>
            <pre
              id="testRawResponse"
              style={{
                background: 'var(--bg-page)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                padding: '0.75rem',
                fontSize: '0.8rem',
                overflowX: 'auto',
                marginTop: '0.5rem',
              }}
            />
          </div>
        </div>
      </div>

      <script dangerouslySetInnerHTML={{ __html: jsCode }} />
    </details>
  );
};
