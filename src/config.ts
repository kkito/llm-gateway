import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export type ProviderType = 'openai' | 'anthropic';

export interface ProviderConfig {
  customModel: string;
  realModel: string;
  apiKey: string;
  baseUrl: string;
  provider: ProviderType;
  desc?: string;
}

/**
 * 用户 API Key 配置
 */
export interface UserApiKey {
  name: string;
  apikey: string;
  desc?: string;
}

export interface ProxyConfig {
  models: ProviderConfig[];
  adminPassword?: string; // SHA256 哈希值
  userApiKeys?: UserApiKey[];
}

const REQUIRED_FIELDS = ['customModel', 'realModel', 'apiKey', 'baseUrl', 'provider'] as const;

/**
 * 对密码进行 SHA256 加密
 * @param password 明文密码
 * @returns SHA256 哈希值
 */
export function hashPassword(password: string): string {
  return createHash('sha256').update('llm-gateway' + password).digest('hex');
}

/**
 * 验证密码是否正确
 * @param password 明文密码
 * @param digest 存储的哈希值
 * @returns 是否匹配
 */
export function verifyPassword(password: string, digest: string): boolean {
  return hashPassword(password) === digest;
}

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

/**
 * 验证配置项是否包含所有必需字段
 */
function validateProviderConfig(config: any, index: number): void {
  for (const field of REQUIRED_FIELDS) {
    if (!config[field]) {
      throw new Error(`Missing required field: ${field} at index ${index}`);
    }
  }
}

/**
 * 验证 models 数组
 */
function validateModelsArray(models: any): ProviderConfig[] {
  if (!Array.isArray(models)) {
    throw new Error('models must be an array');
  }

  models.forEach((item: any, index: number) => {
    validateProviderConfig(item, index);
  });

  return models as ProviderConfig[];
}

/**
 * 加载并验证配置文件（返回 models 数组）
 */
export function loadConfig(configPath: string): ProviderConfig[] {
  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const content = readFileSync(configPath, 'utf-8');

  let config: any;
  try {
    config = JSON.parse(content);
  } catch (error) {
    throw new Error(`Invalid JSON in config file: ${error}`);
  }

  // 向后兼容：如果配置是数组，自动转换为新格式
  if (Array.isArray(config)) {
    config.forEach((item: any, index: number) => {
      validateProviderConfig(item, index);
    });
    return config as ProviderConfig[];
  }

  // 新格式：对象，包含 models 数组
  if (typeof config === 'object' && config !== null) {
    if (!config.models) {
      throw new Error('Config must have a "models" array');
    }
    return validateModelsArray(config.models);
  }

  throw new Error('Config must be an array or an object with "models" array');
}

/**
 * 加载完整配置（包括 adminPassword）
 */
export function loadFullConfig(configPath: string): ProxyConfig {
  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const content = readFileSync(configPath, 'utf-8');

  let config: any;
  try {
    config = JSON.parse(content);
  } catch (error) {
    throw new Error(`Invalid JSON in config file: ${error}`);
  }

  // 向后兼容：如果配置是数组，自动转换为新格式
  if (Array.isArray(config)) {
    config.forEach((item: any, index: number) => {
      validateProviderConfig(item, index);
    });
    return { models: config };
  }

  // 新格式：对象，包含 models 数组
  if (typeof config === 'object' && config !== null) {
    if (!config.models) {
      throw new Error('Config must have a "models" array');
    }
    validateModelsArray(config.models);
    return {
      models: config.models,
      adminPassword: config.adminPassword,
      userApiKeys: config.userApiKeys
    };
  }

  throw new Error('Config must be an array or an object with "models" array');
}

/**
 * 根据 customModel 查找 provider
 */
export function findProvider(config: ProviderConfig[], model: string): ProviderConfig | null {
  return config.find(p => p.customModel === model) || null;
}

/**
 * 保存配置到文件
 */
export function saveConfig(config: ProxyConfig, configPath: string): void {
  const dir = join(configPath, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * 保存配置到文件（旧版本，保持向后兼容）
 * @deprecated 请使用 saveConfig(config, configPath)
 */
export function saveConfigLegacy(configPath: string, config: ProviderConfig[], adminPassword?: string): void {
  const dir = join(configPath, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const proxyConfig: ProxyConfig = { models: config };
  if (adminPassword) {
    proxyConfig.adminPassword = adminPassword;
  }
  writeFileSync(configPath, JSON.stringify(proxyConfig, null, 2), 'utf-8');
}

/**
 * 创建默认空配置
 */
export function createDefaultConfig(configPath: string): void {
  const defaultConfig: ProviderConfig[] = [];
  const proxyConfig: ProxyConfig = { models: defaultConfig };
  saveConfig(proxyConfig, configPath);
}

/**
 * 更新配置项
 */
export function updateConfigEntry(
  config: ProviderConfig[],
  oldCustomModel: string,
  newEntry: ProviderConfig
): ProviderConfig[] {
  const index = config.findIndex(p => p.customModel === oldCustomModel);
  if (index === -1) {
    throw new Error(`未找到模型：${oldCustomModel}`);
  }
  const newConfig = [...config];
  newConfig[index] = newEntry;
  return newConfig;
}

/**
 * 删除配置项
 */
export function deleteConfigEntry(
  config: ProviderConfig[],
  customModel: string
): ProviderConfig[] {
  const index = config.findIndex(p => p.customModel === customModel);
  if (index === -1) {
    throw new Error(`未找到模型：${customModel}`);
  }
  return config.filter(p => p.customModel !== customModel);
}
