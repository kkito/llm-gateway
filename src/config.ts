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

export interface ProxyConfig {
  models: ProviderConfig[];
}

const REQUIRED_FIELDS = ['customModel', 'realModel', 'apiKey', 'baseUrl', 'provider'] as const;

/**
 * 获取默认代理配置目录
 */
export function getProxyDir(): string {
  return join(homedir(), '.llmproxy');
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
 * 加载并验证配置文件
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
 * 根据 customModel 查找 provider
 */
export function findProvider(config: ProviderConfig[], model: string): ProviderConfig | null {
  return config.find(p => p.customModel === model) || null;
}

/**
 * 保存配置到文件
 */
export function saveConfig(configPath: string, config: ProviderConfig[]): void {
  const dir = join(configPath, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const proxyConfig: ProxyConfig = { models: config };
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
