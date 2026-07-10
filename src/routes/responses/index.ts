/**
 * Responses API 路由注册
 * 导出 createResponsesRoute 供 server.ts 使用
 */
import { Hono } from 'hono';
import type { ProxyConfig } from '../../config.js';
import type { Logger } from '../../logger.js';
import type { DetailLogger } from '../../detail-logger.js';
import { createResponsesHandler } from './handler.js';

export function createResponsesRoute(
  config: ProxyConfig | (() => ProxyConfig),
  logger: Logger,
  detailLogger: DetailLogger,
  timeoutMs: number,
  logDir: string
) {
  const router = new Hono();
  const handler = createResponsesHandler(config, logger, detailLogger, timeoutMs, logDir);

  router.post('/v1/responses', (c) => handler(c, '/v1/responses'));
  router.post('/responses', (c) => handler(c, '/responses'));

  return router;
}
