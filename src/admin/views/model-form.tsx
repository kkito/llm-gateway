import { FC } from 'hono/jsx';
import { Layout } from '../components/Layout.js';
import type { ProviderConfig, ProviderType } from '../../config.js';

interface Props {
  model?: ProviderConfig;
  error?: string;
  apiKeyOptions?: { id: string; name: string; provider: string }[];
}

export const ModelFormPage: FC<Props> = (props) => {
  const isEdit = !!props.model;
  const formAction = isEdit ? `/admin/models/edit/${props.model!.customModel}` : '/admin/models';

  return (
    <Layout title={isEdit ? '编辑模型' : '新增模型'}>
      <h1>{isEdit ? '编辑模型' : '新增模型'}</h1>

      {props.error && (
        <article aria-label="错误提示" style={{ backgroundColor: '#fee2e2', color: '#991b1b' }}>
          <strong>错误：</strong> {props.error}
        </article>
      )}

      <form method="post" action={formAction}>
        <label>
          自定义模型名称
          <input
            name="customModel"
            type="text"
            placeholder="例如：my-gpt4"
            value={props.model?.customModel || ''}
            required
          />
          <small>调用 API 时使用此名称</small>
        </label>

        <label>
          实际模型名称
          <input
            name="realModel"
            type="text"
            placeholder="例如：gpt-4"
            value={props.model?.realModel || ''}
            required
          />
          <small>上游 API 支持的模型名称</small>
        </label>

        <label>
          API Provider
          <select name="provider" required>
            <option value="">请选择...</option>
            <option
              value="openai"
              selected={props.model?.provider === 'openai'}
            >
              OpenAI
            </option>
            <option
              value="anthropic"
              selected={props.model?.provider === 'anthropic'}
            >
              Anthropic
            </option>
          </select>
        </label>

        <label>
          Base URL
          <input
            name="baseUrl"
            type="url"
            placeholder="例如：https://api.openai.com"
            value={props.model?.baseUrl || ''}
            required
          />
          <small>API 提供商的地址</small>
        </label>

        <label>
          API Key
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <select
              name="apiKeySource"
              onchange={(e: Event) => {
                const target = e.target as HTMLSelectElement;
                const manualInput = document.getElementById('apiKeyManual') as HTMLInputElement;
                if (target.value === 'manual') {
                  if (manualInput) manualInput.disabled = false;
                } else {
                  if (manualInput) {
                    manualInput.disabled = true;
                    manualInput.value = '';
                  }
                }
              }}
            >
              <option value="manual">手动输入...</option>
              {props.apiKeyOptions?.map((opt) => (
                <option value={opt.id}>{opt.name} ({opt.provider})</option>
              ))}
            </select>
            <input
              id="apiKeyManual"
              name="apiKey"
              type="password"
              placeholder={isEdit ? '留空则保持原密钥不变' : '请输入 API Key'}
              value={isEdit ? '' : (props.model?.apiKey || '')}
              required={!isEdit}
              style={{ flex: 1 }}
            />
          </div>
          {isEdit && <small>留空则保持原密钥不变</small>}
        </label>

        <label>
          描述
          <textarea
            name="desc"
            placeholder="请输入模型描述（可选）"
            rows={3}
          >
            {props.model?.desc || ''}
          </textarea>
          <small>用于记录模型的用途或备注</small>
        </label>

        <button type="submit">{isEdit ? '保存修改' : '添加模型'}</button>
        <a href="/admin/models" role="button" class="secondary" style="margin-left: 0.5rem">
          取消
        </a>
      </form>
    </Layout>
  );
};
