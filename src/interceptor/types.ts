import type { ProviderConfig } from '../config.js'
import type { UpstreamRequest } from '../routes/chat-completions/upstream-request.js'

/**
 * 上游请求拦截器的执行上下文。
 *
 * 包含拦截器在执行时可能需要的所有信息：
 * - provider 配置：用于判断当前请求的目标模型和服务商
 * - 客户端信息：IP、原始请求头等，通过 c（Hono Context）获取
 * - 请求元信息：requestId、customModel、stream 等，用于日志/调试
 */
export interface UpstreamInterceptorContext {
  /** 当前匹配到的 ProviderConfig，包含 customModel/realModel/provider 类型/baseUrl/限流配置等完整信息 */
  provider: ProviderConfig

  /**
   * Hono 请求上下文。
   * 拦截器可通过此对象获取客户端请求信息，例如：
   *   ctx.c.req.header('x-forwarded-for')   // 获取客户端 IP
   *   ctx.c.req.header('Authorization')     // 获取客户端认证信息
   *   ctx.c.req.header('user-agent')        // 获取客户端 User-Agent
   *   ctx.c.req.url                         // 获取客户端请求的原始 URL
   *   ctx.c.req.raw.headers                 // 获取客户端的所有原始请求头
   */
  c: any

  /** 用户认证信息。未认证时为 null */
  currentUser: { name: string; apikey?: string; allowedModels?: string[] } | null

  /**
   * 客户端 IP 地址。
   * 优先从 x-forwarded-for 头获取，其次从 x-real-ip，最后从连接信息。
   * 当无法获取时为 null。
   */
  clientIp: string | null

  /** 请求唯一标识（UUID v4），可用于日志关联 */
  requestId: string

  /** 用户请求中指定的自定义模型名称 */
  customModel: string

  /** 模型组名称（如果请求通过模型组路由），否则为 undefined */
  modelGroup?: string

  /** 是否为流式请求 */
  stream: boolean
}

/**
 * 上游请求拦截器函数签名。
 *
 * 拦截器在 buildUpstreamRequest 完成之后、sendUpstreamRequest 发送之前执行。
 * 此时 upstream 包含的是最终要发送给上游大模型 API 的完整内容：
 *   - url: 已经过 Provider.buildUrl() 处理，包含正确的 endpoint 路径
 *   - headers: 已经过 Provider.buildHeaders() 处理，包含认证信息和必要的请求头
 *   - body: 已经过格式转换（如 OpenAI → Anthropic）和默认参数合并后的最终请求体
 *
 * @param upstream  - 已构建好的上游请求对象。拦截器可以修改其 url/headers/body 中的任意字段
 * @param ctx       - 执行上下文，包含模型配置、客户端信息、请求元信息等
 * @returns         - 修改后的上游请求对象。如果不需要修改，返回原对象或其浅拷贝即可
 *
 * @example
 * // 为 Anthropic 模型添加缓存头
 * async (upstream, ctx) => {
 *   if (ctx.provider.provider === 'anthropic' && ctx.provider.customModel === 'my-claude') {
 *     return {
 *       ...upstream,
 *       headers: { ...upstream.headers, 'anthropic-cache': 'enable' },
 *       body: { ...upstream.body, system: upstream.body.system + '\\n[cached]' }
 *     }
 *   }
 *   return upstream
 * }
 */
export type UpstreamInterceptor = (
  upstream: UpstreamRequest,
  ctx: UpstreamInterceptorContext
) => Promise<UpstreamRequest> | UpstreamRequest
