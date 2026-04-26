import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

export type ProviderType = 'openai' | 'anthropic';

export * from './lib/password.js';
export * from './lib/paths.js';

/**
 * 模型使用限制配置
 */
export interface ModelLimit {
  type: 'requests' | 'input_tokens' | 'cost';
  period: 'day' | 'hours' | 'week' | 'month';
  periodValue?: number;  // 当 period='hours' 时，指定小时数
  max: number;           // 最大限制值
}

export interface ApiKey {
  id: string;
  name: string;
  key: string;
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
  inputPricePer1M?: number;    // 输入 token 每百万价格（美元）
  outputPricePer1M?: number;   // 输出 token 每百万价格（美元）
  cachedPricePer1M?: number;   // 缓存 token 每百万价格（美元）
  limits?: ModelLimit[];       // 使用限制配置
  hidden?: boolean;            // 是否隐藏该模型（不对外展示）
}

/**
 * 用户 API Key 配置
 */
export interface UserApiKey {
  name: string;
  apikey: string;
  desc?: string;
}

/**
 * 模型组配置
 */
export interface ModelGroup {
  name: string;
  models: string[];
  desc?: string;
}

export interface ProxyConfig {
  models: ProviderConfig[];
  modelGroups?: ModelGroup[];
  adminPassword?: string; // SHA256 哈希值
  apiKeys?: ApiKey[];
  userApiKeys?: UserApiKey[];
}

const REQUIRED_FIELDS = ['customModel', 'realModel', 'apiKey', 'baseUrl', 'provider'] as const;

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
 * 验证 ModelLimit 配置
 */
function validateModelLimit(limit: any, index: number, modelIndex: number): void {
  const validTypes = ['requests', 'input_tokens', 'cost'];
  const validPeriods = ['day', 'hours', 'week', 'month'];
  
  if (!validTypes.includes(limit.type)) {
    throw new Error(`Invalid limit type "${limit.type}" at model ${modelIndex}, limit ${index}. Valid types: ${validTypes.join(', ')}`);
  }
  
  if (!validPeriods.includes(limit.period)) {
    throw new Error(`Invalid limit period "${limit.period}" at model ${modelIndex}, limit ${index}. Valid periods: ${validPeriods.join(', ')}`);
  }
  
  if (limit.period === 'hours' && typeof limit.periodValue !== 'number') {
    throw new Error(`Missing periodValue for hours period at model ${modelIndex}, limit ${index}`);
  }
  
  if (typeof limit.max !== 'number') {
    throw new Error(`Missing or invalid max value at model ${modelIndex}, limit ${index}`);
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

    // 验证 limits
    if (item.limits) {
      if (!Array.isArray(item.limits)) {
        throw new Error(`limits must be an array at model ${index}`);
      }
      item.limits.forEach((limit: any, limitIndex: number) => {
        validateModelLimit(limit, limitIndex, index);
      });
    }
  });

  return models as ProviderConfig[];
}

/**
 * 验证 ModelGroup 配置
 */
function validateModelGroups(
  modelGroups: any[],
  models: ProviderConfig[]
): ModelGroup[] {
  const modelNames = new Set(models.map(m => m.customModel));
  const groupNames = new Set<string>();

  modelGroups.forEach((group: any, index: number) => {
    if (!group.name || typeof group.name !== 'string') {
      throw new Error(`Model group at index ${index} must have a name`);
    }

    if (groupNames.has(group.name)) {
      throw new Error(`Duplicate model group name: "${group.name}"`);
    }
    groupNames.add(group.name);

    if (!Array.isArray(group.models) || group.models.length === 0) {
      throw new Error(`Model group "${group.name}" models array cannot be empty`);
    }

    group.models.forEach((modelName: string) => {
      if (!modelNames.has(modelName)) {
        throw new Error(`Model "${modelName}" in group "${group.name}" not found`);
      }
    });
  });

  return modelGroups as ModelGroup[];
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
    if (config.modelGroups) {
      validateModelGroups(config.modelGroups, config.models);
    }
    return {
      models: config.models,
      modelGroups: config.modelGroups,
      adminPassword: config.adminPassword,
      apiKeys: config.apiKeys || [],
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
export function saveConfigLegacy(configPath: string, config: ProviderConfig[], adminPassword?: string, apiKeys?: ApiKey[]): void {
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
  key: string
): ApiKey {
  const now = Date.now();
  const newKey: ApiKey = {
    id: generateId(),
    name,
    key,
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
