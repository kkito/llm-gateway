import type { UpstreamRequest } from '../routes/common/upstream-request.js'
import type { UpstreamInterceptor, UpstreamInterceptorContext } from './types.js'

export type { UpstreamInterceptor, UpstreamInterceptorContext } from './types.js'

/**
 * 拦截器管理器。
 *
 * 管理所有注册的拦截器，按注册顺序依次执行。
 * 每个拦截器的输出作为下一个拦截器的输入，形成链式处理。
 * 拦截器应保持幂等——不修改入参对象，而是返回新对象。
 */
export class InterceptorManager {
  private interceptors: UpstreamInterceptor[] = []

  /**
   * 注册一个上游请求拦截器。
   * 多个拦截器按注册顺序依次执行，前一个的返回值传给后一个。
   *
   * @param interceptor - 拦截器函数
   *
   * @example
   * import { interceptors } from '../interceptor/index.js'
   *
   * // 注册第一个拦截器：统一添加缓存标记
   * interceptors.use(async (upstream, ctx) => {
   *   return { ...upstream, headers: { ...upstream.headers, 'x-cache': '1' } }
   * })
   *
   * // 注册第二个拦截器：只对特定模型生效
   * interceptors.use(async (upstream, ctx) => {
   *   if (ctx.provider.customModel !== 'my-gpt4') return upstream
   *   return { ...upstream, body: { ...upstream.body, max_tokens: 4096 } }
   * })
   */
  use(interceptor: UpstreamInterceptor): void {
    this.interceptors.push(interceptor)
  }

  /**
   * 按注册顺序依次执行所有拦截器。
   * 如果没有任何拦截器注册，直接返回上游请求对象（无操作）。
   *
   * @param upstream - 当前的上游请求对象
   * @param ctx      - 执行上下文
   * @returns        - 所有拦截器处理后的最终上游请求对象
   */
  async execute(
    upstream: UpstreamRequest,
    ctx: UpstreamInterceptorContext
  ): Promise<UpstreamRequest> {
    // 严格按照注册顺序链式执行
    let current = upstream
    for (const interceptor of this.interceptors) {
      current = await interceptor(current, ctx)
    }
    return current
  }

  /**
   * 清除所有已注册的拦截器（主要用于测试）。
   */
  clear(): void {
    this.interceptors.length = 0
  }
}

/**
 * 全局唯一的拦截器管理器实例。
 * 推荐通过此实例注册拦截器，避免创建多个管理器的认知负担。
 */
export const interceptors = new InterceptorManager()
