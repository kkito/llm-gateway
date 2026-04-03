/**
 * 路径工具函数
 */

import { homedir } from 'os';
import { join } from 'path';

/**
 * 获取默认代理配置目录
 */
export function getProxyDir(): string {
  return join(homedir(), '.llm-gateway');
}

/**
 * 获取配置文件路径（默认）
 */
export function getConfigPath(): string {
  return join(getProxyDir(), 'config.json');
}

/**
 * 获取日志目录路径（结构化日志）
 * 默认：~/.llm-gateway/logs/proxy
 */
export function getLogDir(): string {
  return join(getProxyDir(), 'logs/proxy');
}

/**
 * 获取详细日志目录路径（请求/响应完整内容）
 * 默认：~/.llm-gateway/logs
 */
export function getDetailLogDir(): string {
  return join(getProxyDir(), 'logs');
}