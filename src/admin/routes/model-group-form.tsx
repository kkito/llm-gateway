import { Hono } from 'hono';
import type { ProxyConfig } from '../../config.js';
import { loadFullConfig, saveConfig } from '../../config.js';
import { ModelGroupFormPage } from '../views/model-group-form.js';

interface RouteDeps {
  configPath: string;
  onConfigChange: (newConfig: ProxyConfig) => void;
}

export function createModelGroupFormRoute(deps: RouteDeps) {
  const { configPath, onConfigChange } = deps;
  const app = new Hono();

  // 显示新增表单
  app.get('/admin/model-groups/new', (c) => {
    try {
      const proxyConfig = loadFullConfig(configPath);
      return c.html(<ModelGroupFormPage models={proxyConfig.models} />);
    } catch (error: any) {
      return c.html(<ModelGroupFormPage models={[]} error={`加载配置失败：${error.message}`} />);
    }
  });

  // 保存新增配置
  app.post('/admin/model-groups', async (c) => {
    const body = await c.req.parseBody();
    const name = body.name as string;
    const desc = body.desc as string;
    let modelsParam = body.models as string | undefined;

    // 验证组名格式
    if (!name || !/^[-a-zA-Z0-9_.]+$/.test(name)) {
      const proxyConfig = loadFullConfig(configPath);
      return c.html(<ModelGroupFormPage models={proxyConfig.models} error="组名只能包含字母、数字、下划线、中划线、点" />);
    }

    // 解析 JSON 格式的模型数组
    let models: string[] = [];
    if (modelsParam) {
      try {
        models = JSON.parse(modelsParam);
      } catch (e: any) {
        const proxyConfig = loadFullConfig(configPath);
        return c.html(<ModelGroupFormPage models={proxyConfig.models} error="模型数据格式错误" />);
      }
    }

    try {
      const proxyConfig = loadFullConfig(configPath);

      // 检查组名是否已存在
      if (proxyConfig.modelGroups?.some(g => g.name === name)) {
        return c.html(<ModelGroupFormPage models={proxyConfig.models} error={`组名 "${name}" 已存在`} />);
      }

      // 检查是否至少选择一个模型
      if (models.length === 0) {
        return c.html(<ModelGroupFormPage models={proxyConfig.models} error="请至少选择一个模型" />);
      }

      // 创建新配置
      const newGroup = { name, models, desc: desc || undefined };
      proxyConfig.modelGroups = [...(proxyConfig.modelGroups || []), newGroup];
      saveConfig(proxyConfig, configPath);
      onConfigChange(proxyConfig);

      return c.redirect('/admin/model-groups');
    } catch (error: any) {
      const proxyConfig = loadFullConfig(configPath);
      return c.html(<ModelGroupFormPage models={proxyConfig.models} error={`保存失败：${error.message}`} />);
    }
  });

  // 显示编辑表单
  app.get('/admin/model-groups/edit/:name', (c) => {
    const name = c.req.param('name');
    try {
      const proxyConfig = loadFullConfig(configPath);
      const group = proxyConfig.modelGroups?.find(g => g.name === name);

      if (!group) {
        return c.html(<ModelGroupFormPage models={proxyConfig.models} error={`未找到 Model Group：${name}`} isEdit />);
      }

      return c.html(<ModelGroupFormPage models={proxyConfig.models} group={group} isEdit />);
    } catch (error: any) {
      return c.html(<ModelGroupFormPage models={[]} error={`加载配置失败：${error.message}`} isEdit />);
    }
  });

  // 保存编辑后的配置
  app.post('/admin/model-groups/edit/:name', async (c) => {
    const oldName = c.req.param('name');
    const body = await c.req.parseBody();
    const name = body.name as string;
    const desc = body.desc as string;

    // 验证组名格式
    if (!name || !/^[-a-zA-Z0-9_.]+$/.test(name)) {
      const proxyConfig = loadFullConfig(configPath);
      const group = proxyConfig.modelGroups?.find(g => g.name === oldName);
      return c.html(<ModelGroupFormPage models={proxyConfig.models} group={group} error="组名只能包含字母、数字、下划线、中划线、点" isEdit />);
    }

    try {
      const proxyConfig = loadFullConfig(configPath);

      // 检查组名是否与其他组冲突（排除当前组）
      if (proxyConfig.modelGroups?.some(g => g.name === name && g.name !== oldName)) {
        const group = proxyConfig.modelGroups?.find(g => g.name === oldName);
        return c.html(<ModelGroupFormPage models={proxyConfig.models} group={group} error={`组名 "${name}" 已存在`} isEdit />);
      }

      // 更新配置（只更新名称和描述，models 通过 add-model/remove-model/move-model 单独处理）
      const idx = proxyConfig.modelGroups?.findIndex(g => g.name === oldName);
      if (idx !== undefined && idx !== -1) {
        const oldGroup = proxyConfig.modelGroups![idx];
        proxyConfig.modelGroups![idx] = { name, models: oldGroup.models, desc: desc || undefined };
        saveConfig(proxyConfig, configPath);
        onConfigChange(proxyConfig);
      }

      return c.redirect('/admin/model-groups');
    } catch (error: any) {
      const proxyConfig = loadFullConfig(configPath);
      const group = proxyConfig.modelGroups?.find(g => g.name === oldName);
      return c.html(<ModelGroupFormPage models={proxyConfig.models} group={group} error={`保存失败：${error.message}`} isEdit />);
    }
  });

  // 添加模型到 Group（POST 后重定向回编辑页）
  app.post('/admin/model-groups/edit/:name/add-model', async (c) => {
    const name = c.req.param('name');
    const body = await c.req.parseBody();
    const modelName = body.modelName as string;

    if (!modelName) {
      return c.redirect(`/admin/model-groups/edit/${name}`);
    }

    return doAddModel(name, modelName, c);
  });

  // 添加模型到 Group（GET 方式，通过链接）
  app.get('/admin/model-groups/edit/:name/add-model', (c) => {
    const name = c.req.param('name');
    const modelName = c.req.query('modelName');

    if (!modelName) {
      return c.redirect(`/admin/model-groups/edit/${name}`);
    }

    return doAddModel(name, modelName, c);
  });

  async function doAddModel(name: string, modelName: string, ctx: any) {
    try {
      const proxyConfig = loadFullConfig(configPath);
      const idx = proxyConfig.modelGroups?.findIndex(g => g.name === name);
      if (idx === undefined || idx === -1) {
        return ctx.redirect(`/admin/model-groups/edit/${name}`);
      }

      const group = proxyConfig.modelGroups![idx];
      if (!group.models.includes(modelName)) {
        group.models = [...group.models, modelName];
        saveConfig(proxyConfig, configPath);
        onConfigChange(proxyConfig);
      }

      return ctx.redirect(`/admin/model-groups/edit/${name}`);
    } catch (error: any) {
      return ctx.redirect(`/admin/model-groups/edit/${name}`);
    }
  }

  // 从 Group 删除模型（POST 后重定向回编辑页）
  app.post('/admin/model-groups/edit/:name/remove-model', async (c) => {
    const name = c.req.param('name');
    const body = await c.req.parseBody();
    const modelName = body.modelName as string;

    if (!modelName) {
      return c.redirect(`/admin/model-groups/edit/${name}`);
    }

    return doRemoveModel(name, modelName, c);
  });

  // 从 Group 删除模型（GET 方式，通过链接）
  app.get('/admin/model-groups/edit/:name/remove-model', (c) => {
    const name = c.req.param('name');
    const modelName = c.req.query('modelName');

    if (!modelName) {
      return c.redirect(`/admin/model-groups/edit/${name}`);
    }

    return doRemoveModel(name, modelName, c);
  });

  async function doRemoveModel(name: string, modelName: string, ctx: any) {
    try {
      const proxyConfig = loadFullConfig(configPath);
      const idx = proxyConfig.modelGroups?.findIndex(g => g.name === name);
      if (idx === undefined || idx === -1) {
        return ctx.redirect(`/admin/model-groups/edit/${name}`);
      }

      const group = proxyConfig.modelGroups![idx];
      if (group.models.length <= 1) {
        return ctx.redirect(`/admin/model-groups/edit/${name}`);
      }

      group.models = group.models.filter(m => m !== modelName);
      saveConfig(proxyConfig, configPath);
      onConfigChange(proxyConfig);

      return ctx.redirect(`/admin/model-groups/edit/${name}`);
    } catch (error: any) {
      return ctx.redirect(`/admin/model-groups/edit/${name}`);
    }
  }

  // 移动模型顺序（POST 后重定向回编辑页）
  app.post('/admin/model-groups/edit/:name/move-model', async (c) => {
    const name = c.req.param('name');
    const body = await c.req.parseBody();
    const modelName = body.modelName as string;
    const direction = body.direction as string;

    if (!modelName || !direction) {
      return c.redirect(`/admin/model-groups/edit/${name}`);
    }

    return doMoveModel(name, modelName, direction, c);
  });

  // 移动模型顺序（GET 方式，通过链接）
  app.get('/admin/model-groups/edit/:name/move-model', (c) => {
    const name = c.req.param('name');
    const modelName = c.req.query('modelName');
    const direction = c.req.query('direction');

    if (!modelName || !direction) {
      return c.redirect(`/admin/model-groups/edit/${name}`);
    }

    return doMoveModel(name, modelName, direction, c);
  });

  async function doMoveModel(name: string, modelName: string, direction: string, ctx: any) {
    try {
      const proxyConfig = loadFullConfig(configPath);
      const idx = proxyConfig.modelGroups?.findIndex(g => g.name === name);
      if (idx === undefined || idx === -1) {
        return ctx.redirect(`/admin/model-groups/edit/${name}`);
      }

      const group = proxyConfig.modelGroups![idx];
      const currentIdx = group.models.indexOf(modelName);
      if (currentIdx === -1) {
        return ctx.redirect(`/admin/model-groups/edit/${name}`);
      }

      const newIdx = direction === 'up' ? currentIdx - 1 : currentIdx + 1;
      if (newIdx < 0 || newIdx >= group.models.length) {
        return ctx.redirect(`/admin/model-groups/edit/${name}`);
      }

      const newModels = [...group.models];
      [newModels[currentIdx], newModels[newIdx]] = [newModels[newIdx], newModels[currentIdx]];
      group.models = newModels;

      saveConfig(proxyConfig, configPath);
      onConfigChange(proxyConfig);

      return ctx.redirect(`/admin/model-groups/edit/${name}`);
    } catch (error: any) {
      return ctx.redirect(`/admin/model-groups/edit/${name}`);
    }
  }

  return app;
}
