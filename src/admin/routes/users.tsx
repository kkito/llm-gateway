import { Hono } from 'hono';
import { loadFullConfig, getConfigPath, saveConfig } from '../../config.js';
import { generateUserApiKey } from '../../lib/apikey.js';
import { UsersPage } from '../views/users.js';
import { UserFormPage } from '../views/user-form.js';

// 存储禁用前的用户配置，用于恢复
let disabledUserApiKeys: any[] = [];

export function createUsersRoute(configPath?: string) {
  const app = new Hono();

  // 每次创建路由时重置状态（用于测试隔离）
  disabledUserApiKeys = [];

  // 获取配置路径的辅助函数
  const getConfig = () => configPath || getConfigPath();

  // 用户列表页面
  app.get('/admin/users', (c) => {
    try {
      const config = loadFullConfig(getConfig());
      const users = config.userApiKeys || [];
      const authEnabled = config.userApiKeys && config.userApiKeys.length > 0;
      return c.html(<UsersPage users={users} authEnabled={authEnabled} />);
    } catch (error: any) {
      console.error('用户列表页面错误:', error.message);
      return c.html(
        <html>
          <head>
            <title>错误</title>
          </head>
          <body>
            <h1>❌ 加载失败</h1>
            <p>{error.message}</p>
            <a href="/admin/users">返回首页</a>
          </body>
        </html>
      );
    }
  });

  // 用户列表 API
  app.get('/admin/users/api', (c) => {
    const config = loadFullConfig(getConfig());
    const users = config.userApiKeys || [];
    return c.json({ users });
  });

  // 新增用户页面
  app.get('/admin/users/new', (c) => {
    return c.html(<UserFormPage mode="new" />);
  });

  // 新增用户
  app.post('/admin/users/new', async (c) => {
    const body = await c.req.parseBody();
    const name = body.name as string;
    const desc = body.desc as string;

    if (!name) {
      return c.json({ error: '用户名称不能为空' }, 400);
    }

    const config = loadFullConfig(getConfig());

    // 检查用户是否已存在
    if (config.userApiKeys?.find(u => u.name === name)) {
      return c.json({ error: '用户已存在' }, 400);
    }

    const newUser = {
      name,
      apikey: generateUserApiKey(),
      desc: desc || undefined
    };

    if (!config.userApiKeys) {
      config.userApiKeys = [];
    }
    config.userApiKeys.push(newUser);
    saveConfig(config, getConfig());

    return c.redirect('/admin/users');
  });

  // 删除用户
  app.post('/admin/users/delete/:name', async (c) => {
    const name = c.req.param('name');
    const config = loadFullConfig(getConfig());

    if (!config.userApiKeys) {
      return c.json({ error: '用户不存在' }, 404);
    }

    const index = config.userApiKeys.findIndex(u => u.name === name);
    if (index === -1) {
      return c.json({ error: '用户不存在' }, 404);
    }

    config.userApiKeys.splice(index, 1);
    saveConfig(config, getConfig());

    return c.redirect('/admin/users');
  });

  // 编辑用户页面
  app.get('/admin/users/edit/:name', (c) => {
    const name = c.req.param('name');
    const config = loadFullConfig(getConfig());
    const user = config.userApiKeys?.find(u => u.name === name);

    if (!user) {
      return c.html(
        <html>
          <head><title>错误</title></head>
          <body>
            <h1>❌ 用户不存在</h1>
            <a href="/admin/users">返回</a>
          </body>
        </html>,
        404
      );
    }

    return c.html(<UserFormPage mode="edit" user={user} />);
  });

  // 编辑用户
  app.post('/admin/users/edit/:name', async (c) => {
    const name = c.req.param('name');
    const body = await c.req.parseBody();
    const newName = body.name as string;
    const desc = body.desc as string;

    if (!newName) {
      return c.json({ error: '用户名称不能为空' }, 400);
    }

    const config = loadFullConfig(getConfig());
    const userIndex = config.userApiKeys?.findIndex(u => u.name === name);

    if (userIndex === undefined || userIndex === -1) {
      return c.json({ error: '用户不存在' }, 404);
    }

    // 如果修改了名称，检查新名称是否已存在
    if (newName !== name && config.userApiKeys?.find(u => u.name === newName)) {
      return c.json({ error: '用户已存在' }, 400);
    }

    // 更新用户信息
    if (!config.userApiKeys) {
      config.userApiKeys = [];
    }
    config.userApiKeys[userIndex] = {
      ...config.userApiKeys[userIndex],
      name: newName,
      desc: desc || undefined
    };

    saveConfig(config, getConfig());
    return c.redirect('/admin/users');
  });

  // 启用/禁用用户认证
  app.post('/admin/users/toggle', async (c) => {
    const body = await c.req.parseBody();
    const enabled = body.enabled === 'true';
    const config = loadFullConfig(getConfig());

    if (!enabled) {
      // 禁用：保存当前用户配置并清空
      disabledUserApiKeys = config.userApiKeys || [];
      config.userApiKeys = [];
    } else {
      // 启用：恢复之前保存的用户配置
      if (disabledUserApiKeys.length > 0) {
        config.userApiKeys = disabledUserApiKeys;
        disabledUserApiKeys = [];
      }
    }

    saveConfig(config, getConfig());
    return c.redirect('/admin/users');
  });

  return app;
}
