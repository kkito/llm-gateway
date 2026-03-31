import { Hono } from 'hono';
import type { ProviderConfig, ModelLimit } from '../../config.js';
import { loadFullConfig, saveConfig } from '../../config.js';
import { ModelLimitsPage } from '../views/model-limits.js';

interface RouteDeps {
  config: ProviderConfig[] | (() => ProviderConfig[]);
  configPath: string;
  onConfigChange: (newConfig: ProviderConfig[]) => void;
}

export function createModelLimitsRoute(deps: RouteDeps) {
  const { config, configPath, onConfigChange } = deps;
  const app = new Hono();

  // 显示限制管理页面
  app.get('/admin/models/:model/limits', (c) => {
    const modelParam = c.req.param('model');
    const currentConfig = typeof config === 'function' ? config() : config;
    const model = currentConfig.find(p => p.customModel === modelParam);

    if (!model) {
      return c.html(<ModelLimitsPage model={modelParam as any} limits={[]} error={`未找到模型：${modelParam}`} />);
    }

    const limits = model.limits || [];
    return c.html(<ModelLimitsPage model={model} limits={limits} />);
  });

  // 添加限制规则
  app.post('/admin/models/:model/limits/add', async (c) => {
    const modelParam = c.req.param('model');
    const body = await c.req.parseBody();

    const currentConfig = typeof config === 'function' ? config() : config;
    const modelIndex = currentConfig.findIndex(p => p.customModel === modelParam);

    if (modelIndex === -1) {
      return c.html(<ModelLimitsPage model={modelParam as any} limits={[]} error={`未找到模型：${modelParam}`} />);
    }

    const model = currentConfig[modelIndex];
    const type = body.type as string;
    const period = body.period as string | undefined;
    const periodValue = body.periodValue as string | undefined;
    const max = body.max as string;

    // 验证必填字段
    if (!type) {
      const limits = model.limits || [];
      return c.html(<ModelLimitsPage model={model} limits={limits} error="请选择限制类型" />);
    }

    // 根据类型验证
    if (type === 'cost') {
      if (!max) {
        const limits = model.limits || [];
        return c.html(<ModelLimitsPage model={model} limits={limits} error="请填写限制金额" />);
      }
    } else if (type === 'requests' || type === 'input_tokens') {
      if (!period || !max) {
        const limits = model.limits || [];
        return c.html(<ModelLimitsPage model={model} limits={limits} error="请填写时间周期和限制数值" />);
      }
      if (period === 'hours' && !periodValue) {
        const limits = model.limits || [];
        return c.html(<ModelLimitsPage model={model} limits={limits} error="请填写小时数" />);
      }
    }

    // 创建限制规则
    const limit: ModelLimit = {
      type: type as 'requests' | 'input_tokens' | 'cost',
      period: (period || 'day') as 'day' | 'hours' | 'week' | 'month',
      max: parseFloat(max),
    };

    if (period === 'hours' && periodValue) {
      limit.periodValue = parseInt(periodValue);
    }

    try {
      // 添加限制规则
      const limits = model.limits || [];
      const newLimits = [...limits, limit];
      const updatedModel = { ...model, limits: newLimits };

      const newConfigList = [...currentConfig];
      newConfigList[modelIndex] = updatedModel;

      // 保存到文件
      const proxyConfig = loadFullConfig(configPath);
      proxyConfig.models = newConfigList;
      saveConfig(proxyConfig, configPath);

      // 触发配置更新回调
      onConfigChange(newConfigList);

      // 重定向回限制管理页面
      return c.redirect(`/admin/models/${encodeURIComponent(modelParam)}/limits`);
    } catch (error: any) {
      const limits = model.limits || [];
      return c.html(<ModelLimitsPage model={model} limits={limits} error={`保存失败：${error.message}`} />);
    }
  });

  // 删除限制规则
  app.post('/admin/models/:model/limits/delete/:index', async (c) => {
    const modelParam = c.req.param('model');
    const indexParam = c.req.param('index');
    const index = parseInt(indexParam);

    const currentConfig = typeof config === 'function' ? config() : config;
    const modelIndex = currentConfig.findIndex(p => p.customModel === modelParam);

    if (modelIndex === -1) {
      return c.html(<ModelLimitsPage model={modelParam as any} limits={[]} error={`未找到模型：${modelParam}`} />);
    }

    const model = currentConfig[modelIndex];
    const limits = model.limits || [];

    if (index < 0 || index >= limits.length) {
      return c.html(<ModelLimitsPage model={model} limits={limits} error="无效的索引" />);
    }

    try {
      // 删除限制规则
      const newLimits = limits.filter((_, i) => i !== index);
      const updatedModel = { ...model, limits: newLimits.length > 0 ? newLimits : undefined };

      const newConfigList = [...currentConfig];
      newConfigList[modelIndex] = updatedModel;

      // 保存到文件
      const proxyConfig = loadFullConfig(configPath);
      proxyConfig.models = newConfigList;
      saveConfig(proxyConfig, configPath);

      // 触发配置更新回调
      onConfigChange(newConfigList);

      // 重定向回限制管理页面
      return c.redirect(`/admin/models/${encodeURIComponent(modelParam)}/limits`);
    } catch (error: any) {
      return c.html(<ModelLimitsPage model={model} limits={limits} error={`删除失败：${error.message}`} />);
    }
  });

  return app;
}
