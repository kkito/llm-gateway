import { Hono } from 'hono';
import { loadFullConfig, getConfigPath, saveConfig } from '../../config.js';
import { generateUserApiKey } from '../../lib/apikey.js';
import { UsersPage } from '../views/users.js';

export function createUsersRoute() {
  const app = new Hono();

  // 用户列表页面
  app.get('/admin/users', (c) => {
    try {
      const config = loadFullConfig(getConfigPath());
      const users = config.userApiKeys || [];
      return c.html(<UsersPage users={users} />);
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
    const config = loadFullConfig(getConfigPath());
    const users = config.userApiKeys || [];
    return c.json({ users });
  });

  // 新增用户页面
  app.get('/admin/users/new', (c) => {
    return c.html(
      <html>
        <head>
          <title>新增用户</title>
        </head>
        <body>
          <h1>新增用户</h1>
          <form method="post" action="/admin/users/new">
            <div>
              <label for="name">用户名称：</label>
              <input type="text" id="name" name="name" required />
            </div>
            <div>
              <label for="desc">描述：</label>
              <input type="text" id="desc" name="desc" />
            </div>
            <button type="submit">创建</button>
            <a href="/admin/users">取消</a>
          </form>
        </body>
      </html>
    );
  });

  // 新增用户
  app.post('/admin/users/new', async (c) => {
    const body = await c.req.parseBody();
    const name = body.name as string;
    const desc = body.desc as string;

    if (!name) {
      return c.json({ error: '用户名称不能为空' }, 400);
    }

    const config = loadFullConfig(getConfigPath());
    
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
    saveConfig(config, getConfigPath());

    return c.redirect('/admin/users');
  });

  // 删除用户
  app.post('/admin/users/delete/:name', async (c) => {
    const name = c.req.param('name');
    const config = loadFullConfig(getConfigPath());

    const index = config.userApiKeys?.findIndex(u => u.name === name);
    if (index === undefined || index === -1) {
      return c.json({ error: '用户不存在' }, 404);
    }

    config.userApiKeys?.splice(index, 1);
    saveConfig(config, getConfigPath());

    return c.redirect('/admin/users');
  });

  return app;
}
