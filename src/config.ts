import { createHash } from 'crypto';
import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export type ProviderType = 'openai' | 'anthropic';

export interface ApiKey {
  id: string;
  name: string;
  key: string;
  provider: ProviderType;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderConfig {
  customModel: string;
  realModel: string;
  apiKey: string;
  baseUrl: string;
  provider: ProviderType;
  desc?: string;
}

export interface ProxyConfig {
  models: ProviderConfig[];
  adminPassword?: string; // SHA256 哈希值
  apiKeys?: ApiKey[];
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
    return { models: config, apiKeys: [] };
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
      apiKeys: config.apiKeys || []
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
export function saveConfig(configPath: string, config: ProviderConfig[], adminPassword?: string, apiKeys?: ApiKey[]): void {
  const dir = join(configPath, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const proxyConfig: ProxyConfig = { models: config };
  if (adminPassword) {
    proxyConfig.adminPassword = adminPassword;
  }
  if (apiKeys) {
    proxyConfig.apiKeys = apiKeys;
  }
  writeFileSync(configPath, JSON.stringify(proxyConfig, null, 2), 'utf-8');
}

/**
 * 创建默认空配置
 */
export function createDefaultConfig(configPath: string): void {
  const defaultConfig: ProviderConfig[] = [];
  saveConfig(configPath, defaultConfig);
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

/**
 * 生成 UUID
 */
function generateId(): string {
  return randomUUID();
}

/**
 * 添加 API Key
 */
export function addApiKey(
  config: ApiKey[],
  name: string,
  key: string,
  provider: ProviderType
): ApiKey {
  const now = Date.now();
  const newKey: ApiKey = {
    id: generateId(),
    name,
    key,
    provider,
    createdAt: now,
    updatedAt: now
  };
  return newKey;
}

/**
 * 更新 API Key
 */
export function updateApiKey(
  config: ApiKey[],
  id: string,
  updates: Partial<Omit<ApiKey, 'id' | 'createdAt'>>
): ApiKey[] {
  const index = config.findIndex(k => k.id === id);
  if (index === -1) {
    throw new Error(`API Key not found: ${id}`);
  }
  const updated = { ...config[index], ...updates, updatedAt: Date.now() };
  const newConfig = [...config];
  newConfig[index] = updated;
  return newConfig;
}

/**
 * 删除 API Key
 */
export function deleteApiKey(config: ApiKey[], id: string): ApiKey[] {
  const index = config.findIndex(k => k.id === id);
  if (index === -1) {
    throw new Error(`API Key not found: ${id}`);
  }
  return config.filter(k => k.id !== id);
}

/**
 * 获取单个 API Key
 */
export function getApiKey(config: ApiKey[], id: string): ApiKey | null {
  return config.find(k => k.id === id) || null;
}

/**
 * 获取下拉选项（不返回 key 本身）
 */
export function getApiKeyOptions(config: ApiKey[]): Omit<ApiKey, 'key'>[] {
  return config.map(({ key, ...rest }) => rest);
}
