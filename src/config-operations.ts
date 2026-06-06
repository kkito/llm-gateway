import type { ModelGroup, ProxyConfig } from './config.js';

/**
 * 配置级操作——所有"对模型/模型组的删除、重命名"都必须经过本模块的入口，
 * 以便统一维护跨字段的引用清理（modelGroups.models、userApiKeys.allowedModels）。
 *
 * 所有函数均为纯函数：不读写文件、不修改入参。
 * 调用方负责 loadFullConfig → 调本模块 → saveConfig。
 */

/**
 * 从配置中删除一个模型，并清理所有引用：
 *  - 从 modelGroups.models 数组中移除该模型名；引用全空的 modelGroup 整组删除
 *  - 从 userApiKeys.allowedModels 数组中移除该模型名；引用全空时该字段置为 undefined
 *
 * 模型不存在时抛错。
 */
export function removeModelFromConfig(
  config: ProxyConfig,
  modelName: string
): ProxyConfig {
  const index = config.models.findIndex(m => m.customModel === modelName);
  if (index === -1) {
    throw new Error(`未找到模型：${modelName}`);
  }

  const newModels = config.models.filter(m => m.customModel !== modelName);

  const newModelGroups = config.modelGroups
    ?.map(group => ({
      ...group,
      models: group.models.filter(m => m !== modelName),
    }))
    .filter(group => group.models.length > 0);

  const newUserApiKeys = config.userApiKeys?.map(user => {
    if (!user.allowedModels || user.allowedModels.length === 0) {
      return user;
    }
    const filtered = user.allowedModels.filter(m => m !== modelName);
    if (filtered.length === user.allowedModels.length) {
      return user;
    }
    return {
      ...user,
      allowedModels: filtered.length > 0 ? filtered : undefined,
    };
  });

  return {
    ...config,
    models: newModels,
    modelGroups: newModelGroups,
    userApiKeys: newUserApiKeys,
  };
}

/**
 * 重命名一个模型，并更新所有 modelGroups 中的引用。
 * userApiKeys.allowedModels 中的旧名引用不在此处更新——管理员会通过
 * 用户编辑页主动调整；如果旧名已不存在于 models 数组，loadFullConfig 仍会通过
 * （因为 userApiKeys 的引用允许包含任意字符串），由 user-model-access 拦截器兜底。
 *
 * 旧名 === 新名 时幂等返回原 config。
 */
export function renameModelInConfig(
  config: ProxyConfig,
  oldName: string,
  newName: string
): ProxyConfig {
  if (oldName === newName) {
    return config;
  }

  if (!config.modelGroups || config.modelGroups.length === 0) {
    return config;
  }

  const newModelGroups: ModelGroup[] = config.modelGroups.map(group => {
    if (!group.models.includes(oldName)) {
      return group;
    }
    return {
      ...group,
      models: group.models.map(m => (m === oldName ? newName : m)),
    };
  });

  return {
    ...config,
    modelGroups: newModelGroups,
  };
}

/**
 * 从配置中删除一个 model group。
 * 当前不清理 userApiKeys（因为 allowedModels 引用的是模型名而非 group 名），
 * 但仍走本入口以便未来扩展（例如允许 allowedModels 引用 group）。
 *
 * group 不存在时抛错。
 */
export function removeModelGroupFromConfig(
  config: ProxyConfig,
  groupName: string
): ProxyConfig {
  if (!config.modelGroups || !config.modelGroups.some(g => g.name === groupName)) {
    throw new Error(`未找到 Model Group：${groupName}`);
  }

  return {
    ...config,
    modelGroups: config.modelGroups.filter(g => g.name !== groupName),
  };
}

export function renameApiKeyRefInConfig(
  config: ProxyConfig,
  oldName: string,
  newName: string
): ProxyConfig {
  if (oldName === newName) return config;

  return {
    ...config,
    models: config.models.map(m =>
      m.apiKey === `$$${oldName}$$`
        ? { ...m, apiKey: `$$${newName}$$` }
        : m
    ),
  };
}

export function removeApiKeyRefFromConfig(
  config: ProxyConfig,
  keyName: string
): ProxyConfig {
  return {
    ...config,
    models: config.models.map(m =>
      m.apiKey === `$$${keyName}$$`
        ? { ...m, apiKey: '' }
        : m
    ),
  };
}
