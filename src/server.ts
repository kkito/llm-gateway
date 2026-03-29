import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import { watch } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { ProviderConfig } from './config.js';
import { loadConfig } from './config.js';
import type { Logger } from './logger.js';
import { DetailLogger } from './detail-logger.js';
import { createChatCompletionsRoute } from './routes/chat-completions.js';
import { createMessagesRoute } from './routes/messages.js';
import { createModelsRoute } from './admin/routes/models.js';
import { createModelFormRoute } from './admin/routes/model-form.js';
import { createStatsRoute } from './admin/routes/stats.js';
import { createStatsApiRoute } from './admin/routes/stats-api.js';
import { createHomeRoute } from './user/routes/home.js';
import { createLoginRoute as createUserLoginRoute } from './user/routes/login.js';
import { createStatsRoute as createUserStatsRoute } from './user/routes/stats.js';
import { createLogoutRoute } from './user/routes/logout.js';
import { createLoginRoute } from './admin/routes/login.js';
import { createPasswordRoute } from './admin/routes/password.js';
import { createApiKeysRoute } from './admin/routes/api-keys.js';
import { createUsersRoute } from './admin/routes/users.js';
import { authMiddleware, isPasswordConfigured, sessions } from './admin/middleware/auth.js';
import { createUserAuthMiddleware } from './user/middleware/auth.js';
import { loadFullConfig } from './config.js';
import { join as pathJoin } from 'path';

// 获取当前模块目录 (用于静态文件服务)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function createServer(
  config: ProviderConfig[],
  logger: Logger,
  detailLogger: DetailLogger,
  timeoutMs: number = 300000,
  configPath?: string
): Hono {
  const app = new Hono();

  // 从 logger 获取 logDir
  const logDir = pathJoin(logger.getFilePath(), '..');

  // 可变配置引用，用于热加载
  let currentConfig = config;

  // 配置更新回调
  const onConfigChange = (newConfig: ProviderConfig[]) => {
    currentConfig = newConfig;
    console.log('✅ 配置已更新，当前模型数量:', newConfig.length);
  };

  // 文件监听 - 热加载配置
  if (configPath) {
    let debounceTimer: NodeJS.Timeout | null = null;
    watch(configPath, (eventType) => {
      if (eventType === 'change') {
        // 防抖处理
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          try {
            const newConfig = loadConfig(configPath);
            currentConfig = newConfig;
            console.log('🔄 检测到配置文件变化，已重新加载配置');
          } catch (error: any) {
            console.error('❌ 配置文件重新加载失败:', error.message);
          }
        }, 500);
      }
    });
    console.log(`📁 已监听配置文件变化: ${configPath}`);
  }

  // CORS 配置
  app.use('*', cors());

  // 全局请求日志中间件
  app.use('*', async (c, next) => {
    const start = Date.now();
    console.log(`\n📍 [路由] >>> ${c.req.method} ${c.req.path}`);
    await next();
    const duration = Date.now() - start;

    // 记录所有请求（包括健康检查和 404）
    if (c.req.path !== '/health') {
      console.log(`🔍 [HTTP] ${c.req.method} ${c.req.path} - ${c.res.status} (${duration}ms)`);
    }
  });

  // 健康检查
  app.get('/health', (c) => {
    console.log(`🏥 [健康检查]`);
    return c.json({ status: 'ok' });
  });

  // 静态文件服务 - 使用绝对路径确保在生产环境和开发环境都能正确找到文件
  const assetsPath = join(__dirname, 'assets');
  app.use('/assets/*', serveStatic({
    root: assetsPath,
    // 移除 /assets 前缀，因为 root 已经指向 assets 目录
    rewriteRequestPath: (path) => path.replace(/^\/assets/, '')
  }));

  // 404 处理
  app.notFound((c) => {
    console.log(`⚠️  [404] ${c.req.method} ${c.req.path}`);
    return c.json({ error: { message: 'Not Found' } }, 404);
  });

  // 注册路由 - 使用 getter 确保获取最新配置
  app.use('*', async (c, next) => {
    // 将当前配置挂载到 c.env 供路由使用
    (c as any).currentConfig = currentConfig;
    await next();
  });

  // 用户登录路由（需要在认证中间件之前注册）
  if (configPath) {
    app.route('/user/login', createUserLoginRoute({ configPath }));
  }

  // 用户登出路由（需要在认证中间件之前注册）
  app.route('', createLogoutRoute());

  // 用户统计路由（需要在认证中间件之前注册，因为它内部处理认证）
  if (configPath) {
    app.route('/user/stats', createUserStatsRoute(configPath));
  }

  // 用户认证中间件 - 应用到所有 API 路由（仅在配置 userApiKeys 时）
  // 注意：必须在 /user/login 和 /user/stats 之后注册，这样这些路由不会被中间件拦截
  if (configPath) {
    app.use('/user/*', createUserAuthMiddleware(configPath));
    app.use('/v1/*', createUserAuthMiddleware(configPath));
    app.use('/chat/completions', createUserAuthMiddleware(configPath));
    app.use('/messages', createUserAuthMiddleware(configPath));
  }

  // 聊天完成路由
  app.route('', createChatCompletionsRoute(
    () => currentConfig,
    logger,
    detailLogger,
    timeoutMs,
    logDir
  ));

  // 消息路由
  app.route('', createMessagesRoute(
    () => currentConfig,
    logger,
    detailLogger,
    timeoutMs,
    logDir
  ));

  // 登录路由（无需认证）
  if (configPath) {
    app.route('', createLoginRoute({ configPath }));
  }

  // 密码管理路由（需在认证中间件之前注册，因为它内部处理认证逻辑）
  if (configPath) {
    app.route('', createPasswordRoute({ configPath }));
  }

  // API Keys 管理路由
  if (configPath) {
    app.route('', createApiKeysRoute({ configPath }));
  }

  // 为 /admin/* 路由添加认证中间件（仅在已配置密码时）
  if (configPath) {
    app.use('/admin/*', async (c, next) => {
      // 登录页无需认证
      if (c.req.path === '/admin/login') {
        await next();
        return;
      }

      // 检查是否已配置密码
      try {
        const config = loadFullConfig(configPath);
        const hasPassword = isPasswordConfigured(config.adminPassword);

        if (hasPassword) {
          // 已设置密码，需要认证（密码页也不例外）
          // 支持多种 Session 传递方式：Cookie、Authorization Header、Query 参数
          let sessionId: string | undefined;

          // 1. 从 Cookie 获取
          const cookieHeader = c.req.header('Cookie');
          if (cookieHeader) {
            sessionId = cookieHeader.split(';').find(cookie => cookie.trim().startsWith('session='))?.split('=')[1];
          }

          // 2. 从 Authorization Header 获取
          if (!sessionId) {
            const authHeader = c.req.header('Authorization');
            if (authHeader && authHeader.startsWith('Bearer ')) {
              sessionId = authHeader.substring(7);
            }
          }

          // 3. 从 Query 参数获取
          if (!sessionId) {
            sessionId = c.req.query('session');
          }

          if (!sessionId) {
            return c.redirect('/admin/login');
          }

          // 简单的 session 验证
          if (!sessions.has(sessionId)) {
            return c.redirect('/admin/login');
          }
        }
        // 未设置密码时，允许访问所有 admin 页面（包括首次设置密码）
      } catch (error) {
        console.error('认证检查失败:', error);
      }

      await next();
    });
  }

  // 模型列表路由
  app.route('', createModelsRoute(() => currentConfig));

  // 模型表单路由
  if (configPath) {
    app.route('', createModelFormRoute({
      config: () => currentConfig,
      configPath,
      onConfigChange
    }));
  }

  // 统计页面路由
  app.route('', createStatsRoute());

  // 统计 API 路由
  app.route('', createStatsApiRoute());

  // 用户管理路由
  if (configPath) {
    app.route('', createUsersRoute(configPath));
  }

  // 用户首页路由
  app.route('', createHomeRoute(() => currentConfig, configPath));

  return app;
}