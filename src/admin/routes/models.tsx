import { Hono } from 'hono';
import type { ProviderConfig } from '../../config.js';
import { ModelsPage } from '../views/models.js';

export function createModelsRoute(config: ProviderConfig[] | (() => ProviderConfig[])) {
  const app = new Hono();

  app.get('/admin/models', (c) => {
    const currentConfig = typeof config === 'function' ? config() : config;
    return c.html(<ModelsPage models={currentConfig} />);
  });

  return app;
}