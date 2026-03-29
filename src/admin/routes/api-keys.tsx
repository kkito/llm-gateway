import { Hono } from 'hono';
import { loadFullConfig, saveConfig, addApiKey, updateApiKey, deleteApiKey, getApiKey, getApiKeyOptions, type ApiKey } from '../../config.js';
import { ApiKeysPage } from '../views/api-keys.js';

interface RouteDeps {
  configPath: string;
}

export function createApiKeysRoute(deps: RouteDeps) {
  const { configPath } = deps;
  const app = new Hono();

  // GET /admin/api-keys - 列表页面
  app.get('/admin/api-keys', async (c) => {
    try {
      const proxyConfig = loadFullConfig(configPath);
      const apiKeys = getApiKeyOptions(proxyConfig.apiKeys || []);
      return c.html(<ApiKeysPage apiKeys={apiKeys} />);
    } catch (error: any) {
      return c.html(<ApiKeysPage apiKeys={[]} error={`加载失败：${error.message}`} />);
    }
  });

  // POST /admin/api-keys - 新增
  app.post('/admin/api-keys', async (c) => {
    try {
      const body = await c.req.parseBody();
      const name = body.name as string;
      const key = body.key as string;
      const provider = body.provider as 'openai' | 'anthropic';

      if (!name || !key || !provider) {
        const proxyConfig = loadFullConfig(configPath);
        const apiKeys = getApiKeyOptions(proxyConfig.apiKeys || []);
        return c.html(<ApiKeysPage apiKeys={apiKeys} error="请填写所有必填字段" />);
      }

      const proxyConfig = loadFullConfig(configPath);
      const newKey = addApiKey(proxyConfig.apiKeys || [], name, key, provider);
      const apiKeys = [...(proxyConfig.apiKeys || []), newKey];

      saveConfig(configPath, proxyConfig.models, proxyConfig.adminPassword, apiKeys);

      const updatedApiKeys = getApiKeyOptions(apiKeys);
      return c.html(<ApiKeysPage apiKeys={updatedApiKeys} success="API Key 添加成功" />);
    } catch (error: any) {
      const proxyConfig = loadFullConfig(configPath);
      const apiKeys = getApiKeyOptions(proxyConfig.apiKeys || []);
      return c.html(<ApiKeysPage apiKeys={apiKeys} error={`添加失败：${error.message}`} />);
    }
  });

  // GET /admin/api-keys/edit/:id - 编辑页面
  app.get('/admin/api-keys/edit/:id', async (c) => {
    try {
      const id = c.req.param('id');
      const proxyConfig = loadFullConfig(configPath);
      const apiKey = getApiKey(proxyConfig.apiKeys || [], id);

      if (!apiKey) {
        const apiKeys = getApiKeyOptions(proxyConfig.apiKeys || []);
        return c.html(<ApiKeysPage apiKeys={apiKeys} error="未找到该 API Key" />);
      }

      const apiKeys = getApiKeyOptions(proxyConfig.apiKeys || []);
      const { key: _removed, ...editingKey } = apiKey;
      return c.html(<ApiKeysPage apiKeys={apiKeys} editingKey={editingKey} />);
    } catch (error: any) {
      const proxyConfig = loadFullConfig(configPath);
      const apiKeys = getApiKeyOptions(proxyConfig.apiKeys || []);
      return c.html(<ApiKeysPage apiKeys={apiKeys} error={`加载失败：${error.message}`} />);
    }
  });

  // POST /admin/api-keys/edit/:id - 更新
  app.post('/admin/api-keys/edit/:id', async (c) => {
    try {
      const id = c.req.param('id');
      const body = await c.req.parseBody();
      const name = body.name as string;
      const key = body.key as string;
      const provider = body.provider as 'openai' | 'anthropic';

      const proxyConfig = loadFullConfig(configPath);
      const currentApiKey = getApiKey(proxyConfig.apiKeys || [], id);

      if (!name || !provider) {
        const apiKeys = getApiKeyOptions(proxyConfig.apiKeys || []);
        if (currentApiKey) {
          const { key: _removed, ...editingKey } = currentApiKey;
          return c.html(<ApiKeysPage apiKeys={apiKeys} editingKey={editingKey} error="请填写所有必填字段" />);
        }
        return c.html(<ApiKeysPage apiKeys={apiKeys} error="请填写所有必填字段" />);
      }

      const updates: Partial<ApiKey> = { name, provider };
      if (key) {
        updates.key = key;
      }

      const apiKeys = updateApiKey(proxyConfig.apiKeys || [], id, updates);
      saveConfig(configPath, proxyConfig.models, proxyConfig.adminPassword, apiKeys);

      const updatedApiKeys = getApiKeyOptions(apiKeys);
      return c.html(<ApiKeysPage apiKeys={updatedApiKeys} success="API Key 更新成功" />);
    } catch (error: any) {
      const proxyConfig = loadFullConfig(configPath);
      const apiKeys = getApiKeyOptions(proxyConfig.apiKeys || []);
      return c.html(<ApiKeysPage apiKeys={apiKeys} error={`更新失败：${error.message}`} />);
    }
  });

  // POST /admin/api-keys/delete/:id - 删除
  app.post('/admin/api-keys/delete/:id', async (c) => {
    try {
      const id = c.req.param('id');
      const proxyConfig = loadFullConfig(configPath);

      const apiKeys = deleteApiKey(proxyConfig.apiKeys || [], id);
      saveConfig(configPath, proxyConfig.models, proxyConfig.adminPassword, apiKeys);

      const updatedApiKeys = getApiKeyOptions(apiKeys);
      return c.html(<ApiKeysPage apiKeys={updatedApiKeys} success="API Key 已删除" />);
    } catch (error: any) {
      const proxyConfig = loadFullConfig(configPath);
      const apiKeys = getApiKeyOptions(proxyConfig.apiKeys || []);
      return c.html(<ApiKeysPage apiKeys={apiKeys} error={`删除失败：${error.message}`} />);
    }
  });

  return app;
}