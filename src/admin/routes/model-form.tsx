import { Hono } from 'hono';
import type { ProviderConfig, ProxyConfig } from '../../config.js';
import { saveConfig, loadConfig, updateConfigEntry, deleteConfigEntry } from '../../config.js';
import { ModelFormPage } from '../views/model-form.js';
import { ModelsPage } from '../views/models.js';

interface RouteDeps {
  config: ProviderConfig[] | (() => ProviderConfig[]);
  configPath: string;
  onConfigChange: (newConfig: ProviderConfig[]) => void;
}

export function createModelFormRoute(deps: RouteDeps) {
  const { config, configPath, onConfigChange } = deps;
  const app = new Hono();

  // 显示新增表单
  app.get('/admin/models/new', (c) => {
    return c.html(<ModelFormPage />);
  });

  // 保存新配置
  app.post('/admin/models', async (c) => {
    const body = await c.req.parseBody();

    const customModel = body.customModel as string;
    const realModel = body.realModel as string;
    const apiKey = body.apiKey as string;
    const baseUrl = body.baseUrl as string;
    const provider = body.provider as 'openai' | 'anthropic';
    const desc = body.desc as string;

    // 获取当前配置
    const currentConfig = typeof config === 'function' ? config() : config;

    // 验证必填字段
    if (!customModel || !realModel || !apiKey || !baseUrl || !provider) {
      return c.html(<ModelFormPage error="请填写所有必填字段" />);
    }

    // 检查是否已存在同名模型
    const existingIndex = currentConfig.findIndex(p => p.customModel === customModel);
    if (existingIndex >= 0) {
      return c.html(
        <ModelFormPage
          error={`模型 "${customModel}" 已存在，请使用不同的名称`}
          model={{ customModel, realModel, apiKey, baseUrl, provider, desc }}
        />
      );
    }

    try {
      // 创建新配置
      const newConfig: ProviderConfig = {
        customModel,
        realModel,
        apiKey,
        baseUrl,
        provider,
        desc: desc || undefined
      };

      // 保存到文件
      const newConfigList = [...currentConfig, newConfig];
      const proxyConfig: ProxyConfig = { models: newConfigList };
      saveConfig(proxyConfig, configPath);

      // 触发配置更新回调
      onConfigChange(newConfigList);

      // 重定向到列表页
      return c.redirect('/admin/models');
    } catch (error: any) {
      return c.html(<ModelFormPage error={`保存失败：${error.message}`} />);
    }
  });

  // 显示编辑表单
  app.get('/admin/models/edit/:model', (c) => {
    const modelParam = c.req.param('model');
    const currentConfig = typeof config === 'function' ? config() : config;
    const model = currentConfig.find(p => p.customModel === modelParam);

    if (!model) {
      return c.html(<ModelFormPage error={`未找到模型：${modelParam}`} />);
    }

    return c.html(<ModelFormPage model={model} />);
  });

  // 保存编辑后的配置
  app.post('/admin/models/edit/:model', async (c) => {
    const oldModel = c.req.param('model');
    const body = await c.req.parseBody();

    const customModel = body.customModel as string;
    const realModel = body.realModel as string;
    const apiKey = body.apiKey as string;
    const baseUrl = body.baseUrl as string;
    const provider = body.provider as 'openai' | 'anthropic';
    const desc = body.desc as string;

    // 获取当前配置
    const currentConfig = typeof config === 'function' ? config() : config;
    const oldEntry = currentConfig.find(p => p.customModel === oldModel);

    if (!oldEntry) {
      return c.html(<ModelFormPage error={`未找到模型：${oldModel}`} />);
    }

    // 验证必填字段（编辑时 apiKey 可不填，使用原值）
    if (!customModel || !realModel || !baseUrl || !provider) {
      return c.html(<ModelFormPage error="请填写所有必填字段" model={{ customModel, realModel, apiKey, baseUrl, provider, desc }} />);
    }

    // 检查新名称是否与其他模型冲突（排除当前模型）
    const existingIndex = currentConfig.findIndex(p => p.customModel === customModel && p.customModel !== oldModel);
    if (existingIndex >= 0) {
      return c.html(
        <ModelFormPage
          error={`模型 "${customModel}" 已存在，请使用不同的名称`}
          model={{ customModel, realModel, apiKey, baseUrl, provider, desc }}
        />
      );
    }

    try {
      // 更新配置（apiKey 留空则使用原值）
      const newEntry: ProviderConfig = {
        customModel,
        realModel,
        apiKey: apiKey || oldEntry.apiKey,
        baseUrl,
        provider,
        desc: desc || undefined
      };

      const newConfigList = updateConfigEntry(currentConfig, oldModel, newEntry);
      const proxyConfig: ProxyConfig = { models: newConfigList };
      saveConfig(proxyConfig, configPath);

      // 触发配置更新回调
      onConfigChange(newConfigList);

      // 重定向到列表页
      return c.redirect('/admin/models');
    } catch (error: any) {
      return c.html(<ModelFormPage error={`保存失败：${error.message}`} model={{ customModel, realModel, apiKey, baseUrl, provider, desc }} />);
    }
  });

  // 删除配置
  app.post('/admin/models/delete/:model', async (c) => {
    const modelParam = c.req.param('model');
    const currentConfig = typeof config === 'function' ? config() : config;

    try {
      const newConfigList = deleteConfigEntry(currentConfig, modelParam);
      const proxyConfig: ProxyConfig = { models: newConfigList };
      saveConfig(proxyConfig, configPath);

      // 触发配置更新回调
      onConfigChange(newConfigList);

      // 重定向到列表页
      return c.redirect('/admin/models');
    } catch (error: any) {
      return c.html(<ModelsPage models={currentConfig} error={`删除失败：${error.message}`} />);
    }
  });

  // 移动模型顺序
  app.post('/admin/models/move/:model', async (c) => {
    const modelParam = c.req.param('model');
    const direction = c.req.query('direction');
    const currentConfig = typeof config === 'function' ? config() : config;

    const currentIndex = currentConfig.findIndex(p => p.customModel === modelParam);
    if (currentIndex === -1) {
      return c.html(<ModelsPage models={currentConfig} error={`未找到模型：${modelParam}`} />);
    }

    try {
      let newIndex: number;
      if (direction === 'up') {
        newIndex = currentIndex - 1;
      } else if (direction === 'down') {
        newIndex = currentIndex + 1;
      } else {
        return c.redirect('/admin/models');
      }

      // 检查边界
      if (newIndex < 0 || newIndex >= currentConfig.length) {
        return c.redirect('/admin/models');
      }

      // 交换数组元素
      const newConfigList = [...currentConfig];
      const temp = newConfigList[currentIndex];
      newConfigList[currentIndex] = newConfigList[newIndex];
      newConfigList[newIndex] = temp;

      const proxyConfig: ProxyConfig = { models: newConfigList };
      saveConfig(proxyConfig, configPath);

      // 触发配置更新回调
      onConfigChange(newConfigList);

      // 重定向到列表页
      return c.redirect('/admin/models');
    } catch (error: any) {
      return c.html(<ModelsPage models={currentConfig} error={`移动失败：${error.message}`} />);
    }
  });

  return app;
}
