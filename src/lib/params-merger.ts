/**
 * 深度递归合并对象
 * - 基本类型：override 覆盖 base
 * - 对象类型：递归合并
 * - 数组类型：override 整体替换 base
 */
export function deepMerge(base: any, override: any): any {
  if (override === null || typeof override !== 'object' || Array.isArray(override)) {
    return override;
  }
  if (base === null || typeof base !== 'object' || Array.isArray(base)) {
    return override;
  }

  const result = { ...base };
  for (const key of Object.keys(override)) {
    if (key in base) {
      result[key] = deepMerge(base[key], override[key]);
    } else {
      result[key] = override[key];
    }
  }
  return result;
}

/**
 * 合并默认参数和用户参数
 * 用户参数优先级更高
 */
export function mergeModelParams(
  defaultParams: Record<string, any> | undefined,
  userBody: any
): any {
  if (defaultParams === undefined || defaultParams === null) {
    return userBody;
  }
  // defaultParams 作为 base，userBody 作为 override（用户优先级更高）
  return deepMerge(defaultParams, userBody);
}
