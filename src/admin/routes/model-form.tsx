import { Hono } from 'hono';
import type { ProviderConfig, ProxyConfig } from '../../config.js';
import { saveConfig, loadConfig, updateConfigEntry, deleteConfigEntry, loadFullConfig, getApiKeyOptions } from '../../config.js';
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
    try {
      const proxyConfig = loadFullConfig(configPath);
      const apiKeyOptions = getApiKeyOptions(proxyConfig.apiKeys || []);
      return c.html(<ModelFormPage apiKeyOptions={apiKeyOptions} />);
    } catch (error: any) {
      return c.html(<ModelFormPage error={`加载配置失败：${error.message}`} />);
    }
  });

  // 保存新配置
  app.post('/admin/models', async (c) => {
    const body = await c.req.parseBody();

    const customModel = body.customModel as string;
    const realModel = body.realModel as string;
    const baseUrl = body.baseUrl as string;
    const provider = body.provider as 'openai' | 'anthropic';
    const desc = body.desc as string;
    const apiKeySource = body.apiKeySource as string;
    const apiKey = body.apiKey as string;

    // 获取当前配置
    const currentConfig = typeof config === 'function' ? config() : config;

    // 处理 API Key：优先使用下拉框选择的，其次使用手动输入的
    let finalApiKey: string;
    if (apiKeySource && apiKeySource !== 'manual') {
      // 从配置中查找选中的 API Key
      try {
        const proxyConfig = loadFullConfig(configPath);
        const selectedKey = proxyConfig.apiKeys?.find(k => k.id === apiKeySource);
        if (!selectedKey) {
          return c.html(<ModelFormPage error={`未找到 API Key：${apiKeySource}`} apiKeyOptions={getApiKeyOptions(proxyConfig.apiKeys || [])} />);
        }
        finalApiKey = selectedKey.key;
      } catch (error: any) {
        return c.html(<ModelFormPage error={`加载配置失败：${error.message}`} />);
      }
    } else if (apiKey) {
      // 使用手动输入的 API Key
      finalApiKey = apiKey;
    } else {
      // 两者都没有，返回错误
      const proxyConfig = loadFullConfig(configPath);
      return c.html(<ModelFormPage error="请填写所有必填字段" apiKeyOptions={getApiKeyOptions(proxyConfig.apiKeys || [])} />);
    }

    // 验证其他必填字段
    if (!customModel || !realModel || !baseUrl || !provider) {
      const proxyConfig = loadFullConfig(configPath);
      return c.html(<ModelFormPage error="请填写所有必填字段" apiKeyOptions={getApiKeyOptions(proxyConfig.apiKeys || [])} />);
    }

    // 检查是否已存在同名模型
    const existingIndex = currentConfig.findIndex(p => p.customModel === customModel);
    if (existingIndex >= 0) {
      const proxyConfig = loadFullConfig(configPath);
      return c.html(
        <ModelFormPage
          error={`模型 "${customModel}" 已存在，请使用不同的名称`}
          model={{ customModel, realModel, apiKey: finalApiKey, baseUrl, provider, desc }}
          apiKeyOptions={getApiKeyOptions(proxyConfig.apiKeys || [])}
        />
      );
    }

    try {
      // 创建新配置
      const newConfig: ProviderConfig = {
        customModel,
        realModel,
        apiKey: finalApiKey,
        baseUrl,
        provider,
        desc: desc || undefined
      };

      // 保存到文件 - 保留 apiKeys 等其他配置
      const newConfigList = [...currentConfig, newConfig];
      const proxyConfig = loadFullConfig(configPath);
      proxyConfig.models = newConfigList;
      saveConfig(proxyConfig, configPath);

      // 触发配置更新回调
      onConfigChange(newConfigList);

      // 重定向到列表页
      return c.redirect('/admin/models');
    } catch (error: any) {
      const proxyConfig = loadFullConfig(configPath);
      return c.html(<ModelFormPage error={`保存失败：${error.message}`} apiKeyOptions={getApiKeyOptions(proxyConfig.apiKeys || [])} />);
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

    try {
      const proxyConfig = loadFullConfig(configPath);
      const apiKeyOptions = getApiKeyOptions(proxyConfig.apiKeys || []);
      return c.html(<ModelFormPage model={model} apiKeyOptions={apiKeyOptions} />);
    } catch (error: any) {
      return c.html(<ModelFormPage model={model} error={`加载配置失败：${error.message}`} />);
    }
  });

  // 保存编辑后的配置
  app.post('/admin/models/edit/:model', async (c) => {
    const oldModel = c.req.param('model');
    const body = await c.req.parseBody();

    const customModel = body.customModel as string;
    const realModel = body.realModel as string;
    const baseUrl = body.baseUrl as string;
    const provider = body.provider as 'openai' | 'anthropic';
    const desc = body.desc as string;
    const apiKeySource = body.apiKeySource as string | undefined;
    const apiKey = body.apiKey as string | undefined;

    // 获取当前配置
    const currentConfig = typeof config === 'function' ? config() : config;
    const oldEntry = currentConfig.find(p => p.customModel === oldModel);

    if (!oldEntry) {
      return c.html(<ModelFormPage error={`未找到模型：${oldModel}`} />);
    }

    // 验证必填字段
    if (!customModel || !realModel || !baseUrl || !provider) {
      const proxyConfig = loadFullConfig(configPath);
      return c.html(<ModelFormPage error="请填写所有必填字段" model={{ customModel, realModel, apiKey: apiKey || '', baseUrl, provider, desc }} apiKeyOptions={getApiKeyOptions(proxyConfig.apiKeys || [])} />);
    }

    // 处理 API Key：优先使用下拉框选择的，其次使用手动输入的，最后使用原值
    let finalApiKey: string = oldEntry.apiKey; // 默认使用原值
    
    if (apiKeySource && apiKeySource !== 'manual') {
      // 从配置中查找选中的 API Key
      try {
        const proxyConfig = loadFullConfig(configPath);
        const selectedKey = proxyConfig.apiKeys?.find(k => k.id === apiKeySource);
        if (selectedKey) {
          finalApiKey = selectedKey.key;
        }
      } catch (error: any) {
        // 加载失败则使用原值
      }
    } else if (apiKey && apiKey !== '') {
      // 使用手动输入的 API Key
      finalApiKey = apiKey;
    }
    // 如果两者都没有，使用原值（finalApiKey 已初始化为原值）

    // 检查新名称是否与其他模型冲突（排除当前模型）
    const existingIndex = currentConfig.findIndex(p => p.customModel === customModel && p.customModel !== oldModel);
    if (existingIndex >= 0) {
      const proxyConfig = loadFullConfig(configPath);
      return c.html(
        <ModelFormPage
          error={`模型 "${customModel}" 已存在，请使用不同的名称`}
          model={{ customModel, realModel, apiKey: finalApiKey, baseUrl, provider, desc }}
          apiKeyOptions={getApiKeyOptions(proxyConfig.apiKeys || [])}
        />
      );
    }

    try {
      // 更新配置
      const newEntry: ProviderConfig = {
        customModel,
        realModel,
        apiKey: finalApiKey,
        baseUrl,
        provider,
        desc: desc || undefined
      };

      const newConfigList = updateConfigEntry(currentConfig, oldModel, newEntry);
      // 保存到文件 - 保留 apiKeys 等其他配置
      const proxyConfig = loadFullConfig(configPath);
      proxyConfig.models = newConfigList;
      saveConfig(proxyConfig, configPath);

      // 触发配置更新回调
      onConfigChange(newConfigList);

      // 重定向到列表页
      return c.redirect('/admin/models');
    } catch (error: any) {
      const proxyConfig = loadFullConfig(configPath);
      return c.html(<ModelFormPage error={`保存失败：${error.message}`} model={{ customModel, realModel, apiKey: finalApiKey, baseUrl, provider, desc }} apiKeyOptions={getApiKeyOptions(proxyConfig.apiKeys || [])} />);
    }
  });

  // 删除配置
  app.post('/admin/models/delete/:model', async (c) => {
    const modelParam = c.req.param('model');
    const currentConfig = typeof config === 'function' ? config() : config;

    try {
      const newConfigList = deleteConfigEntry(currentConfig, modelParam);
      // 保存到文件 - 保留 apiKeys 等其他配置
      const proxyConfig = loadFullConfig(configPath);
      proxyConfig.models = newConfigList;
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

      // 保存到文件 - 保留 apiKeys 等其他配置
      const proxyConfig = loadFullConfig(configPath);
      proxyConfig.models = newConfigList;
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
