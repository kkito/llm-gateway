import { Hono } from 'hono';
import type { ProxyConfig } from '../../config.js';
import { loadFullConfig, saveConfig } from '../../config.js';
import { ModelGroupsPage } from '../views/model-groups.js';

interface RouteDeps {
  configPath: string;
  onConfigChange: (newConfig: ProxyConfig) => void;
}

export function createModelGroupsRoute(deps: RouteDeps) {
  const { configPath, onConfigChange } = deps;
  const app = new Hono();

  app.get('/admin/model-groups', (c) => {
    try {
      const proxyConfig = loadFullConfig(configPath);
      return c.html(<ModelGroupsPage modelGroups={proxyConfig.modelGroups || []} />);
    } catch (error: any) {
      return c.html(<ModelGroupsPage modelGroups={[]} error={`加载失败：${error.message}`} />);
    }
  });

  app.post('/admin/model-groups/delete/:name', async (c) => {
    const name = c.req.param('name');
    try {
      const proxyConfig = loadFullConfig(configPath);
      proxyConfig.modelGroups = (proxyConfig.modelGroups || []).filter(g => g.name !== name);
      saveConfig(proxyConfig, configPath);
      onConfigChange(proxyConfig);
      return c.redirect('/admin/model-groups');
    } catch (error: any) {
      const proxyConfig = loadFullConfig(configPath);
      return c.html(<ModelGroupsPage modelGroups={proxyConfig.modelGroups || []} error={`删除失败：${error.message}`} />);
    }
  });

  return app;
}
