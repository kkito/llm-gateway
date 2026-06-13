import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import { fileURLToPath } from 'url';
import { dirname, join, join as pathJoin } from 'path';
import type { ProviderConfig, ProxyConfig } from './config.js';
import type { Logger } from './logger.js';
import { DetailLogger } from './detail-logger.js';
import { createChatCompletionsRoute } from './routes/chat-completions/index.js';
import { createMessagesRoute } from './routes/messages/index.js';
import { createModelsRoute } from './admin/routes/models.js';
import { createModelFormRoute } from './admin/routes/model-form.js';
import { createModelLimitsRoute } from './admin/routes/model-limits.js';
import { createModelGroupsRoute } from './admin/routes/model-groups.js';
import { createModelGroupFormRoute } from './admin/routes/model-group-form.js';
import { createStatsRoute } from './admin/routes/stats.js';
import { createStatsApiRoute, initStatsProvider, resetStatsProvider } from './admin/routes/stats-api.js';
import { createUsageApiRoute, initUsageApiTracker, resetUsageApiTracker } from './admin/routes/usage-api.js';
import { createHomeRoute } from './user/routes/home.js';
import { createLoginRoute as createUserLoginRoute } from './user/routes/login.js';
import { createStatsRoute as createUserStatsRoute } from './user/routes/stats.js';
import { createLogoutRoute } from './user/routes/logout.js';
import { createLoginRoute } from './admin/routes/login.js';
import { createPasswordRoute } from './admin/routes/password.js';
import { createPrivacyRoute } from './admin/routes/privacy.js';
import { createApiKeysRoute } from './admin/routes/api-keys.js';
import { createUsersRoute } from './admin/routes/users.js';
import { createAnnouncementRoute } from './admin/routes/announcement.js';
import { authMiddleware, isPasswordConfigured, sessions } from './admin/middleware/auth.js';
import { createUserAuthMiddleware } from './user/middleware/auth.js';
import { loadFullConfig } from './config.js';
import { UsageTracker } from './lib/usage-tracker.js';
import { StatsProvider } from './lib/stats-provider.js';
import { createConfigContext } from './lib/config-context.js';
import { interceptors } from './interceptor/index.js'
import { anthropicBillingCleaner } from './interceptor/anthropic-billing-cleaner.js'
import { claudeCodeCache } from './interceptor/claude-code-cache.js'
import { cacheControlNormalize } from './interceptor/cache-control-normalize.js'
import { ttlManagement } from './interceptor/ttl-management.js'
import { claudeCodeNormalize } from './interceptor/claude-code-normalize.js'
import { qwenCacheInterceptor } from './interceptor/qwen-cache.js'
import { opencodeSessionInterceptor } from './interceptor/opencode-session.js'
import { userModelAccessInterceptor } from './interceptor/user-model-access.js'
import { DatabaseManager } from './lib/db.js';
import { RequestLogger } from './lib/request-logger.js';

// 拦截器执行顺序：
// 1. anthropic-billing-cleaner — 必须最先执行：先清理掉 billing header 残留 + fingerprint 稳定化
// 2. claude-code-cache — 针对 Claude Code 请求的 4 个缓存子优化（smoosh-split → sort-stabilization → fresh-session-sort → content-strip）
// 3. cache-control-normalize — 规范化 cache_control 标记：分散标记 → 最后一个块
// 4. ttl-management — 在所有 cache_control 标记上注入正确的 TTL 值
// 5. claude-code-normalize — 针对 Claude Code 的 4 个规范化功能（session-start → tool-use-input → deferred-tools-restore → cache-control-sticky）
// 6. opencode-session — OpenCode 会话注入（应用层功能）
// 7. qwen-cache — Qwen 缓存处理（应用层功能）
interceptors.use(anthropicBillingCleaner)
interceptors.use(claudeCodeCache)
interceptors.use(cacheControlNormalize)
interceptors.use(ttlManagement)
interceptors.use(claudeCodeNormalize)
interceptors.use(opencodeSessionInterceptor)
interceptors.use(qwenCacheInterceptor)
interceptors.use(userModelAccessInterceptor)

// 获取当前模块目录 (用于静态文件服务)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 导出全局变量：允许测试重置状态
export let hasSetupSignalHandlers = false;
export let cleanupInterval: ReturnType<typeof setInterval> | null = null;

// 保存 signal handler 引用，以便测试时移除
let sigintHandler: (() => void) | null = null;
let sigtermHandler: (() => void) | null = null;

// 测试辅助函数：重置全局状态
export function resetServerGlobalState(): void {
  hasSetupSignalHandlers = false;
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  // 移除已注册的 signal handlers（防止测试间累积）
  if (sigintHandler) {
    process.removeListener('SIGINT', sigintHandler);
    sigintHandler = null;
  }
  if (sigtermHandler) {
    process.removeListener('SIGTERM', sigtermHandler);
    sigtermHandler = null;
  }
  // 重置模块级全局变量（用于测试隔离）
  resetStatsProvider();
  resetUsageApiTracker();
  DatabaseManager.resetInstance();
  RequestLogger.resetInstance();
}

export function createServer(
  config: ProxyConfig,
  logger: Logger,
  detailLogger: DetailLogger,
  timeoutMs: number = 300000,
  configDir?: string
): Hono {
  // 保留原始 configDir 值（用于判断是否是测试环境）
  const isTestEnv = !configDir;

  // 自动重置全局状态（防止测试间污染）
  hasSetupSignalHandlers = false;
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  if (sigintHandler) {
    process.removeListener('SIGINT', sigintHandler);
    sigintHandler = null;
  }
  if (sigtermHandler) {
    process.removeListener('SIGTERM', sigtermHandler);
    sigtermHandler = null;
  }
  resetStatsProvider();
  resetUsageApiTracker();

  const app = new Hono();

  const ctx = createConfigContext(configDir);
  // 当 configDir 未指定时，从 logger 获取 logDir（用于测试环境）
  const logDir = configDir ? ctx.logDir : pathJoin(logger.getFilePath(), '..');

  // 创建用量追踪器（单例）
  const usageTracker = UsageTracker.getInstance(logDir);

  // 初始化 UsageTracker API
  initUsageApiTracker(usageTracker);

  // 创建统计提供者（共享 usageTracker 实例）
  const statsProvider = new StatsProvider(usageTracker, logDir);
  initStatsProvider(statsProvider);

  // Initialize SQLite database for request logging (only in non-test mode)
  if (!isTestEnv) {
    const dbManager = DatabaseManager.getInstance(ctx.logDir);
    dbManager.initialize();

    // Start async request logger
    const requestLogger = RequestLogger.getInstance(dbManager);
    requestLogger.start();

    // 定期清理过期的滑动窗口数据（每小时清理一次）
    if (!cleanupInterval) {
      cleanupInterval = setInterval(() => {
        statsProvider.cleanup();
        dbManager.cleanupOldRequests(90);
        console.log('🧹 已清理过期数据');
      }, 60 * 60 * 1000); // 1 小时
    }

    // 确保进程退出时清理定时器（只注册一次）
    if (!hasSetupSignalHandlers) {
      hasSetupSignalHandlers = true;

      sigintHandler = () => {
        if (cleanupInterval) clearInterval(cleanupInterval);
        requestLogger.stop();
        dbManager.close();
        process.exit(0);
      };

      sigtermHandler = () => {
        if (cleanupInterval) clearInterval(cleanupInterval);
        requestLogger.stop();
        dbManager.close();
        process.exit(0);
      };

      process.on('SIGINT', sigintHandler);
      process.on('SIGTERM', sigtermHandler);
    }
  }

  // 可变配置引用，用于后台 API 更新
  let currentConfig = config;

  // 配置更新回调（由后台 API 调用）
  const onConfigChange = (newConfig: ProxyConfig) => {
    currentConfig = newConfig;
    console.log('✅ 配置已更新，当前模型数量:', newConfig.models.length);
  };

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
    // 忽略浏览器扩展或自动补全产生的无效请求（如 /admin/&）
    if (c.req.path === '/admin/&' || c.req.path === '/admin/') {
      return c.body(null, 204); // 返回空响应，不记录日志
    }
    
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
  if (!isTestEnv) {
    app.route('/user/login', createUserLoginRoute({ configPath: ctx.configPath }));
  }

  // 用户登出路由（需要在认证中间件之前注册）
  app.route('', createLogoutRoute());

  // 用户统计路由（需要在认证中间件之前注册，因为它内部处理认证）
  if (!isTestEnv) {
    app.route('/user/stats', createUserStatsRoute(ctx.configPath));
  }

  // 用户认证中间件 - 应用到所有 API 路由（仅在配置 userApiKeys 时）
  // 注意：必须在 /user/login 和 /user/stats 之后注册，这样这些路由不会被中间件拦截
  if (!isTestEnv) {
    app.use('/user/*', createUserAuthMiddleware(ctx.configPath));
    app.use('/v1/*', createUserAuthMiddleware(ctx.configPath));
    app.use('/chat/completions', createUserAuthMiddleware(ctx.configPath));
    app.use('/messages', createUserAuthMiddleware(ctx.configPath));
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

  // 认证中间件 - 必须在这里注册（在所有 admin 路由之前），这样才能拦截所有 /admin/* 路由
  // 注意：/admin/login 路径会被单独处理，不需要认证
  if (!isTestEnv) {
    app.use('/admin/*', async (c, next) => {
      // 登录页无需认证
      if (c.req.path === '/admin/login') {
        await next();
        return;
      }

      // 检查是否已配置密码
      try {
        const config = loadFullConfig(ctx.configPath);
        const hasPassword = isPasswordConfigured(config.adminPassword);

        if (hasPassword) {
          // 已设置密码，需要认证
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
        // 未设置密码时，允许访问所有 admin 页面
      } catch (error) {
        console.error('认证检查失败:', error);
      }

      await next();
    });
  }

  // 登录路由（无需认证）
  if (!isTestEnv) {
    app.route('', createLoginRoute({ configPath: ctx.configPath }));
  }

  // 密码管理路由（内部也做了认证检查，作为双重保障）
  if (!isTestEnv) {
    app.route('', createPasswordRoute({ configPath: ctx.configPath }));
  }

  // 隐私保护路由
  if (!isTestEnv) {
    app.route('', createPrivacyRoute({ configPath: ctx.configPath, onConfigChange }));
  }

  // 公告管理路由
  if (!isTestEnv) {
    app.route('', createAnnouncementRoute({
      configPath: ctx.configPath,
      onConfigChange
    }));
  }

  // API Keys 管理路由
  if (!isTestEnv) {
    app.route('', createApiKeysRoute({ configPath: ctx.configPath }));
  }

  // 模型列表路由
  app.route('', createModelsRoute(() => currentConfig));

  // 模型表单路由
  if (!isTestEnv) {
    app.route('', createModelFormRoute({
      config: () => currentConfig,
      configPath: ctx.configPath,
      onConfigChange
    }));
  }

  // 模型限制管理路由
  if (!isTestEnv) {
    app.route('', createModelLimitsRoute({
      config: () => currentConfig,
      configPath: ctx.configPath,
      onConfigChange,
      usageTracker
    }));
  }

  // Model Groups 表单路由（需在列表路由之前注册，确保 /admin/model-groups/new 优先匹配）
  if (!isTestEnv) {
    app.route('', createModelGroupFormRoute({
      configPath: ctx.configPath,
      onConfigChange
    }));
  }

  // Model Groups 管理路由
  if (!isTestEnv) {
    app.route('', createModelGroupsRoute({
      configPath: ctx.configPath,
      onConfigChange
    }));
  }

  // 统计页面路由
  app.route('', createStatsRoute());

  // 统计 API 路由
  app.route('', createStatsApiRoute());

  // 实时用量 API 路由
  app.route('', createUsageApiRoute());

  // 用户管理路由
  if (!isTestEnv) {
    app.route('', createUsersRoute(ctx.configPath));
  }

  // 用户首页路由
  app.route('', createHomeRoute(() => currentConfig, ctx.configPath));

  return app;
}