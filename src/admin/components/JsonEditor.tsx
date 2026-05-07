import { FC } from 'hono/jsx';

interface Props {
  name: string;
  value?: string;
}

export const JsonEditor: FC<Props> = (props) => {
  const safeValue = props.value || '';
  // Sanitize name to prevent XSS in inline handler strings
  const sanitizedName = props.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const uniqueId = `je-${sanitizedName}-${Math.random().toString(36).slice(2, 8)}`;

  const jsCode = `
(function() {
  window.jsonEditorValidate = function(id) {
    var textarea = document.getElementById(id + '-input');
    var preview = document.getElementById(id + '-preview');
    var hidden = document.getElementById(id + '-hidden');
    try {
      var obj = JSON.parse(textarea.value);
      var formatted = JSON.stringify(obj, null, 2);
      preview.textContent = formatted;
      preview.setAttribute('data-valid', 'true');
      preview.style.background = '#dcfce7';
      hidden.value = formatted;
    } catch (e) {
      preview.textContent = 'JSON 格式错误：' + e.message;
      preview.setAttribute('data-valid', 'false');
      preview.style.background = '#fef2f2';
      hidden.value = textarea.value;
    }
  };
  window.jsonEditorFormat = function(id) {
    var textarea = document.getElementById(id + '-input');
    try {
      var obj = JSON.parse(textarea.value);
      textarea.value = JSON.stringify(obj, null, 2);
      window.jsonEditorValidate(id);
    } catch (e) {
      alert('JSON 格式错误：' + e.message);
    }
  };
  window.jsonEditorClear = function(id) {
    var textarea = document.getElementById(id + '-input');
    var preview = document.getElementById(id + '-preview');
    var hidden = document.getElementById(id + '-hidden');
    textarea.value = '';
    preview.textContent = '等待输入...';
    preview.setAttribute('data-valid', 'true');
    preview.style.background = '#dcfce7';
    hidden.value = '';
  };
})();
  `.trim();

  return (
    <div style="display: flex; gap: 1rem; margin-bottom: 0.5rem;">
      <div style="flex: 1;">
        <textarea
          id={`${uniqueId}-input`}
          style={{
            width: '100%',
            minHeight: '180px',
            padding: '0.75rem',
            fontFamily: 'monospace',
            fontSize: '0.85rem',
            border: '1.5px solid var(--border-color)',
            borderRadius: '8px',
            resize: 'vertical',
            background: 'var(--bg-page)'
          }}
          placeholder='{"temperature": 0.7, "max_tokens": 4096}'
          oninput={`jsonEditorValidate('${uniqueId}')`}
        >{safeValue}</textarea>
        <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem;">
          <button
            type="button"
            style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', cursor: 'pointer' }}
            onclick={`jsonEditorFormat('${uniqueId}')`}
          >格式化</button>
          <button
            type="button"
            style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', cursor: 'pointer' }}
            onclick={`jsonEditorClear('${uniqueId}')`}
          >清空</button>
        </div>
      </div>
      <div style="flex: 1;">
        <pre
          id={`${uniqueId}-preview`}
          data-valid="true"
          style={{
            width: '100%',
            minHeight: '180px',
            padding: '0.75rem',
            fontFamily: 'monospace',
            fontSize: '0.85rem',
            border: '1.5px solid var(--border-color)',
            borderRadius: '8px',
            overflow: 'auto',
            background: '#dcfce7'
          }}
        >{safeValue || '等待输入...'}</pre>
      </div>
      <input type="hidden" name={props.name} id={`${uniqueId}-hidden`} value={safeValue} />
      <script dangerouslySetInnerHTML={{ __html: jsCode }} />
    </div>
  );
};
