import { Hono } from 'hono';
import { PrivacySettingsPage } from '../views/privacy-settings.js';
import { loadFullConfig, saveConfig } from '../../config.js';

interface PrivacySettings {
  enabled: boolean;
  stripUserField: boolean;
  sanitizeFilePaths: boolean;
  pathPlaceholder: string;
  whitelistFilter: boolean;
}

interface RouteDeps {
  configPath: string;
  onConfigChange: (config: any) => void;
  cliDebug?: boolean;
}

const DEFAULT_SETTINGS: PrivacySettings = {
  enabled: false,
  stripUserField: false,
  sanitizeFilePaths: false,
  pathPlaceholder: '__USER__',
  whitelistFilter: false
};

export function createPrivacyRoute(deps: RouteDeps) {
  const { configPath, onConfigChange, cliDebug = false } = deps;
  const app = new Hono();

  app.get('/admin/privacy', (c) => {
    try {
      const proxyConfig = loadFullConfig(configPath);
      const settings = proxyConfig.privacySettings || DEFAULT_SETTINGS;
      return c.html(<PrivacySettingsPage settings={settings} detailLogEnabled={proxyConfig.detailLogEnabled === true} cliDebug={cliDebug} />);
    } catch (error: any) {
      return c.html(<PrivacySettingsPage settings={DEFAULT_SETTINGS} detailLogEnabled={false} cliDebug={cliDebug} error={`加载失败：${error.message}`} />);
    }
  });

  app.post('/admin/privacy', async (c) => {
    try {
      const proxyConfig = loadFullConfig(configPath);
      const body = await c.req.parseBody();

      const settings: PrivacySettings = {
        enabled: body.enabled === 'on',
        stripUserField: body.stripUserField === 'on',
        sanitizeFilePaths: body.sanitizeFilePaths === 'on',
        pathPlaceholder: (body.pathPlaceholder as string) || DEFAULT_SETTINGS.pathPlaceholder,
        whitelistFilter: body.whitelistFilter === 'on'
      };

      proxyConfig.privacySettings = settings;
      proxyConfig.detailLogEnabled = body.detailLogEnabled === 'on';
      saveConfig(proxyConfig, configPath);
      onConfigChange(proxyConfig);

      return c.html(<PrivacySettingsPage settings={settings} detailLogEnabled={proxyConfig.detailLogEnabled} cliDebug={cliDebug} success="设置已保存" />);
    } catch (error: any) {
      const proxyConfig = loadFullConfig(configPath);
      const settings = proxyConfig.privacySettings || DEFAULT_SETTINGS;
      return c.html(<PrivacySettingsPage settings={settings} detailLogEnabled={proxyConfig.detailLogEnabled === true} cliDebug={cliDebug} error={`保存失败：${error.message}`} />);
    }
  });

  return app;
}
