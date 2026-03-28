import { Hono } from 'hono';
import { PasswordPage } from '../views/password.js';
import { hashPassword, verifyPassword, loadFullConfig, saveConfig } from '../../config.js';
import { isPasswordConfigured } from '../middleware/auth.js';

interface RouteDeps {
  configPath: string;
}

export function createPasswordRoute(deps: RouteDeps) {
  const { configPath } = deps;
  const app = new Hono();

  // 显示密码管理页
  app.get('/admin/password', (c) => {
    try {
      const proxyConfig = loadFullConfig(configPath);
      const hasPassword = isPasswordConfigured(proxyConfig.adminPassword);
      return c.html(<PasswordPage hasPassword={hasPassword} />);
    } catch (error: any) {
      return c.html(<PasswordPage error={`加载失败：${error.message}`} hasPassword={false} />);
    }
  });

  // 处理密码修改
  app.post('/admin/password', async (c) => {
    try {
      const proxyConfig = loadFullConfig(configPath);
      const body = await c.req.parseBody();
      const action = body.action as string;
      
      const hasPassword = isPasswordConfigured(proxyConfig.adminPassword);

      // 删除密码
      if (action === 'delete') {
        if (hasPassword) {
          // 验证当前密码
          const currentPassword = body.currentPassword as string;
          if (!currentPassword || !verifyPassword(currentPassword, proxyConfig.adminPassword!)) {
            return c.html(<PasswordPage error="当前密码错误" hasPassword={true} />);
          }
          
          // 删除密码
          delete proxyConfig.adminPassword;
          saveConfig(configPath, proxyConfig.models);

          return c.html(<PasswordPage success="密码已删除" hasPassword={false} />);
        }
        return c.html(<PasswordPage error="当前未设置密码" hasPassword={false} />);
      }

      // 修改/设置密码
      if (action === 'change') {
        const newPassword = body.newPassword as string;
        const confirmPassword = body.confirmPassword as string;

        // 验证新密码
        if (!newPassword || newPassword.length < 1) {
          return c.html(<PasswordPage error="新密码不能为空" hasPassword={hasPassword} />);
        }

        // 验证两次输入一致
        if (newPassword !== confirmPassword) {
          return c.html(<PasswordPage error="两次输入的新密码不一致" hasPassword={hasPassword} />);
        }

        // 如果是修改密码，验证当前密码
        if (hasPassword) {
          const currentPassword = body.currentPassword as string;
          if (!currentPassword || !verifyPassword(currentPassword, proxyConfig.adminPassword!)) {
            return c.html(<PasswordPage error="当前密码错误" hasPassword={true} />);
          }
        }

        // 设置新密码
        proxyConfig.adminPassword = hashPassword(newPassword);
        saveConfig(configPath, proxyConfig.models, proxyConfig.adminPassword);

        return c.html(<PasswordPage success="密码已更新" hasPassword={true} />);
      }

      return c.html(<PasswordPage error="未知操作" hasPassword={hasPassword} />);
    } catch (error: any) {
      return c.html(<PasswordPage error={`操作失败：${error.message}`} hasPassword={false} />);
    }
  });

  return app;
}
