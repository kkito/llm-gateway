import type { UpstreamInterceptor } from './types.js'

export class PermissionError extends Error {
  constructor(model: string) {
    super(`You don't have access to model: ${model}`)
    this.name = 'PermissionError'
  }
}

export const userModelAccessInterceptor: UpstreamInterceptor = async (upstream, ctx) => {
  const { currentUser, customModel, modelGroup } = ctx
  // 模型组请求不做限制（由 spec 约束）
  if (modelGroup) return upstream
  if (!currentUser) return upstream

  const allowed = currentUser.allowedModels
  if (!allowed || allowed.length === 0) return upstream

  if (!allowed.includes(customModel)) {
    throw new PermissionError(customModel)
  }

  return upstream
}
