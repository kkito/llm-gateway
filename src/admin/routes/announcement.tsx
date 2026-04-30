import { Hono } from 'hono';
import type { UiSettings, ProxyConfig } from '../../config.js';
import { AnnouncementPage } from '../views/announcement.js';
import { loadFullConfig, saveConfig } from '../../config.js';

interface RouteDeps {
  configPath: string;
  onConfigChange: (config: ProxyConfig) => void;
}

const DEFAULT_UI_SETTINGS: UiSettings = {
  enabled: false,
  announcementMarkdown: ''
};

export function createAnnouncementRoute(deps: RouteDeps) {
  const { configPath, onConfigChange } = deps;
  const app = new Hono();

  app.get('/admin/announcement', (c) => {
    try {
      const proxyConfig = loadFullConfig(configPath);
      const settings = proxyConfig.uiSettings || DEFAULT_UI_SETTINGS;
      return c.html(<AnnouncementPage settings={settings} />);
    } catch (error: any) {
      return c.html(
        <AnnouncementPage
          settings={DEFAULT_UI_SETTINGS}
          error={`加载失败：${error.message}`}
        />
      );
    }
  });

  app.post('/admin/announcement', async (c) => {
    try {
      const proxyConfig = loadFullConfig(configPath);
      const body = await c.req.parseBody();

      const settings: UiSettings = {
        enabled: body.enabled === 'on',
        announcementMarkdown: (body.announcementMarkdown as string) || ''
      };

      proxyConfig.uiSettings = settings;
      saveConfig(proxyConfig, configPath);
      onConfigChange(proxyConfig);

      return c.html(
        <AnnouncementPage settings={settings} success="设置已保存" />
      );
    } catch (error: any) {
      const proxyConfig = loadFullConfig(configPath);
      const settings = proxyConfig.uiSettings || DEFAULT_UI_SETTINGS;
      return c.html(
        <AnnouncementPage settings={settings} error={`保存失败：${error.message}`} />
      );
    }
  });

  return app;
}
