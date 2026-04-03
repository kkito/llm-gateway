/**
 * Routes 共享工具函数
 */

import type { ProviderConfig } from '../../config.js';

/**
 * 解析请求体中的模型参数
 * 返回 { model, modelGroup, stream }
 */
export function parseModelParams(body: any): {
  model: string | undefined;
  modelGroup: string | undefined;
  stream: boolean;
} {
  const { model, model_group, stream } = body;
  return {
    model,
    modelGroup: model_group,
    stream: Boolean(stream)
  };
}

/**
 * 验证模型参数互斥
 */
export function validateModelMutualExclusion(model: string | undefined, modelGroup: string | undefined): string | null {
  if (model && modelGroup) {
    return 'model and model_group are mutually exclusive';
  }
  return null;
}

/**
 * 创建错误响应
 */
export function createErrorResponse(message: string, type: string = 'invalid_request_error') {
  return {
    error: { message, type }
  };
}

/**
 * 解析错误消息
 */
export function parseErrorMessage(error: any): string {
  if (typeof error === 'string') return error;
  if (error?.message) return error.message;
  return 'Unknown error';
}

/**
 * 从 ProviderConfig[] 中查找模型对应的 Provider
 */
export function findModelProvider(
  providers: ProviderConfig[],
  model: string
): ProviderConfig | null {
  return providers.find(p => p.customModel === model) || null;
}