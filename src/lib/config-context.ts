/**
 * Configuration context - derives all paths from a single base directory.
 */

import { join } from 'path';
import {
  getProxyDir,
  getConfigPathFromDir,
  getLogDirFromDir,
  getDetailLogDirFromDir,
  getPidFileFromDir,
} from './paths.js';

/**
 * Configuration context - derives all paths from a single base directory.
 */
export interface ConfigContext {
  /** Working directory */
  configDir: string;
  /** config.json path */
  configPath: string;
  /** logs/proxy directory (structured logs) */
  logDir: string;
  /** logs directory (detail logs) */
  detailLogDir: string;
  /** llm-gateway.pid file */
  pidFile: string;
}

/**
 * Create a ConfigContext from a base directory.
 * @param configDir - Base directory (defaults to ~/.llm-gateway)
 */
export function createConfigContext(configDir?: string): ConfigContext {
  const dir = configDir ?? getProxyDir();
  return {
    configDir: dir,
    configPath: getConfigPathFromDir(dir),
    logDir: getLogDirFromDir(dir),
    detailLogDir: getDetailLogDirFromDir(dir),
    pidFile: getPidFileFromDir(dir),
  };
}
