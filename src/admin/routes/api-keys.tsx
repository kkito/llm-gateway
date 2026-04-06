import { Hono } from 'hono';
import { loadFullConfig, saveConfig, addApiKey, updateApiKey, deleteApiKey, getApiKey, getApiKeyOptions, type ApiKey } from '../../config.js';
import { ApiKeysPage } from '../views/api-keys.js';
import { isPasswordConfigured, sessions } from '../middleware/auth.js';

interface RouteDeps {
  configPath: string;
}

// 认证检查辅助函数
function checkAuth(c: any): boolean {
  let sessionId: string | undefined;
  const cookieHeader = c.req.header('Cookie');
  if (cookieHeader) {
    sessionId = cookieHeader.split(';').find((cookie: string) => cookie.trim().startsWith('session='))?.split('=')[1];
  }
  if (!sessionId) {
    const authHeader = c.req.header('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      sessionId = authHeader.substring(7);
    }
  }
  if (!sessionId) {
    sessionId = c.req.query('session');
  }
  return !!(sessionId && sessions.has(sessionId));
}

export function createApiKeysRoute(deps: RouteDeps) {
  const { configPath } = deps;
  const app = new Hono();

  // 需要认证的路由包装器
  const requireAuth = async (c: any, next: () => Promise<void>) => {
    const proxyConfig = loadFullConfig(configPath);
    if (isPasswordConfigured(proxyConfig.adminPassword) && !checkAuth(c)) {
      return c.redirect('/admin/login');
    }
    await next();
  };

  // GET /admin/api-keys - 列表页面
  app.get('/admin/api-keys', requireAuth, async (c) => {
    try {
      const proxyConfig = loadFullConfig(configPath);
      const apiKeys = getApiKeyOptions(proxyConfig.apiKeys || []);
      return c.html(<ApiKeysPage apiKeys={apiKeys} />);
    } catch (error: any) {
      return c.html(<ApiKeysPage apiKeys={[]} error={`加载失败：${error.message}`} />);
    }
  });

  // POST /admin/api-keys - 新增
  app.post('/admin/api-keys', requireAuth, async (c) => {
    try {
      const body = await c.req.parseBody();
      const name = body.name as string;
      const key = body.key as string;

      if (!name || !key) {
        const proxyConfig = loadFullConfig(configPath);
        const apiKeys = getApiKeyOptions(proxyConfig.apiKeys || []);
        return c.html(<ApiKeysPage apiKeys={apiKeys} error="请填写所有必填字段" />);
      }

      const proxyConfig = loadFullConfig(configPath);
      const newKey = addApiKey(proxyConfig.apiKeys || [], name, key);
      const apiKeys = [...(proxyConfig.apiKeys || []), newKey];

      saveConfig({ ...proxyConfig, apiKeys }, configPath);

      const updatedApiKeys = getApiKeyOptions(apiKeys);
      return c.html(<ApiKeysPage apiKeys={updatedApiKeys} success="API Key 添加成功" />);
    } catch (error: any) {
      const proxyConfig = loadFullConfig(configPath);
      const apiKeys = getApiKeyOptions(proxyConfig.apiKeys || []);
      return c.html(<ApiKeysPage apiKeys={apiKeys} error={`添加失败：${error.message}`} />);
    }
  });

  // GET /admin/api-keys/edit/:id - 编辑页面
  app.get('/admin/api-keys/edit/:id', requireAuth, async (c) => {
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
  app.post('/admin/api-keys/edit/:id', requireAuth, async (c) => {
    try {
      const id = c.req.param('id');
      const body = await c.req.parseBody();
      const name = body.name as string;
      const key = body.key as string;

      const proxyConfig = loadFullConfig(configPath);
      const currentApiKey = getApiKey(proxyConfig.apiKeys || [], id);

      if (!name) {
        const apiKeys = getApiKeyOptions(proxyConfig.apiKeys || []);
        if (currentApiKey) {
          const { key: _removed, ...editingKey } = currentApiKey;
          return c.html(<ApiKeysPage apiKeys={apiKeys} editingKey={editingKey} error="请填写所有必填字段" />);
        }
        return c.html(<ApiKeysPage apiKeys={apiKeys} error="请填写所有必填字段" />);
      }

      const updates: Partial<ApiKey> = { name };
      if (key) {
        updates.key = key;
      }

      const apiKeys = updateApiKey(proxyConfig.apiKeys || [], id, updates);
      saveConfig({ ...proxyConfig, apiKeys }, configPath);

      const updatedApiKeys = getApiKeyOptions(apiKeys);
      return c.html(<ApiKeysPage apiKeys={updatedApiKeys} success="API Key 更新成功" />);
    } catch (error: any) {
      const proxyConfig = loadFullConfig(configPath);
      const apiKeys = getApiKeyOptions(proxyConfig.apiKeys || []);
      return c.html(<ApiKeysPage apiKeys={apiKeys} error={`更新失败：${error.message}`} />);
    }
  });

  // POST /admin/api-keys/delete/:id - 删除
  app.post('/admin/api-keys/delete/:id', requireAuth, async (c) => {
    try {
      const id = c.req.param('id');
      const proxyConfig = loadFullConfig(configPath);

      const apiKeys = deleteApiKey(proxyConfig.apiKeys || [], id);
      saveConfig({ ...proxyConfig, apiKeys }, configPath);

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