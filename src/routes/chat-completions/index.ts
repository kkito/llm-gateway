/**
 * Chat Completions 路由注册
 * 导出 createChatCompletionsRoute 供 server.ts 使用
 */
import { Hono } from 'hono';
import type { ProxyConfig } from '../../config.js';
import type { Logger } from '../../logger.js';
import type { DetailLogger } from '../../detail-logger.js';
import { createChatCompletionsHandler } from './handler.js';

export function createChatCompletionsRoute(
  config: ProxyConfig | (() => ProxyConfig),
  logger: Logger,
  detailLogger: DetailLogger,
  timeoutMs: number,
  logDir: string
) {
  const router = new Hono();
  const handler = createChatCompletionsHandler(config, logger, detailLogger, timeoutMs, logDir);

  router.post('/v1/chat/completions', (c) => handler(c, '/v1/chat/completions'));
  router.post('/chat/completions', (c) => handler(c, '/chat/completions'));
  router.post('/v1/v1/chat/completions', (c) => handler(c, '/v1/v1/chat/completions'));

  return router;
}
