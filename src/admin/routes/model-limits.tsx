import { Hono } from 'hono';
import type { ProviderConfig, ModelLimit } from '../../config.js';
import { loadFullConfig, saveConfig } from '../../config.js';
import { ModelLimitsPage } from '../views/model-limits.js';
import { UsageTracker } from '../../lib/usage-tracker.js';
import { getPeriodDescription } from '../../lib/period-utils.js';

interface LimitWithUsage extends ModelLimit {
  currentUsage: number;
  periodDesc: string;
}

interface RouteDeps {
  config: ProviderConfig[] | (() => ProviderConfig[]);
  configPath: string;
  onConfigChange: (newConfig: ProviderConfig[]) => void;
  usageTracker: UsageTracker;
}

export function createModelLimitsRoute(deps: RouteDeps) {
  const { config, configPath, onConfigChange, usageTracker } = deps;
  const app = new Hono();

  // 显示限制管理页面
  app.get('/admin/models/:model/limits', async (c) => {
    const modelParam = c.req.param('model');
    const currentConfig = typeof config === 'function' ? config() : config;
    const model = currentConfig.find(p => p.customModel === modelParam);

    if (!model) {
      return c.html(<ModelLimitsPage model={modelParam as any} limits={[]} error={`未找到模型：${modelParam}`} />);
    }

    const limits = model.limits || [];
    
    // 计算每条规则的当前使用量
    const counter = usageTracker.getCounter(model.customModel);
    const pricing = model.inputPricePer1M !== undefined && 
                    model.outputPricePer1M !== undefined && 
                    model.cachedPricePer1M !== undefined ? {
      inputPricePer1M: model.inputPricePer1M,
      outputPricePer1M: model.outputPricePer1M,
      cachedPricePer1M: model.cachedPricePer1M
    } : undefined;

    // 确保用量数据已加载
    for (const limit of limits) {
      await usageTracker.ensureLoaded(counter, limit.period, limit.periodValue, pricing);
    }

    // 构建带有使用量数据的限制规则
    const limitsWithUsage = limits.map(limit => {
      const currentUsage = usageTracker.getCurrentUsage(counter, limit);
      const periodDesc = getPeriodDescription(limit.period, limit.periodValue);
      return {
        ...limit,
        currentUsage,
        periodDesc
      };
    });

    return c.html(<ModelLimitsPage model={model} limits={limitsWithUsage} />);
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
      const emptyLimits: LimitWithUsage[] = [];
      return c.html(<ModelLimitsPage model={model} limits={emptyLimits} error="请选择限制类型" />);
    }

    // 根据类型验证
    if (type === 'cost') {
      if (!max) {
        const emptyLimits: LimitWithUsage[] = [];
        return c.html(<ModelLimitsPage model={model} limits={emptyLimits} error="请填写限制金额" />);
      }
    } else if (type === 'requests' || type === 'input_tokens') {
      if (!period || !max) {
        const emptyLimits: LimitWithUsage[] = [];
        return c.html(<ModelLimitsPage model={model} limits={emptyLimits} error="请填写时间周期和限制数值" />);
      }
      if (period === 'hours' && !periodValue) {
        const emptyLimits: LimitWithUsage[] = [];
        return c.html(<ModelLimitsPage model={model} limits={emptyLimits} error="请填写小时数" />);
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
      const emptyLimits: LimitWithUsage[] = [];
      return c.html(<ModelLimitsPage model={model} limits={emptyLimits} error={`保存失败：${error.message}`} />);
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
      const emptyLimits: LimitWithUsage[] = [];
      return c.html(<ModelLimitsPage model={model} limits={emptyLimits} error="无效的索引" />);
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
      const emptyLimits: LimitWithUsage[] = [];
      return c.html(<ModelLimitsPage model={model} limits={emptyLimits} error={`删除失败：${error.message}`} />);
    }
  });

  return app;
}
