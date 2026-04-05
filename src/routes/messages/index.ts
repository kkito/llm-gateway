/**
 * Messages 路由注册
 * 导出 createMessagesRoute 供 server.ts 使用
 */
import { Hono } from 'hono';
import type { ProxyConfig } from '../../config.js';
import type { Logger } from '../../logger.js';
import type { DetailLogger } from '../../detail-logger.js';
import { createMessagesHandler } from './handler.js';

export function createMessagesRoute(
  config: ProxyConfig | (() => ProxyConfig),
  logger: Logger,
  detailLogger: DetailLogger,
  timeoutMs: number,
  logDir: string
) {
  const router = new Hono();
  const handler = createMessagesHandler(config, logger, detailLogger, timeoutMs, logDir);

  router.post('/v1/messages', (c) => handler(c, '/v1/messages'));
  router.post('/messages', (c) => handler(c, '/messages'));
  router.post('/v1/v1/messages', (c) => handler(c, '/v1/v1/messages'));

  return router;
}
