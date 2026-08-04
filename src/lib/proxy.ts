import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from 'undici';

/**
 * 代理地址 → dispatcher 的惰性缓存，避免相同代理地址反复创建 ProxyAgent。
 */
const dispatcherCache = new Map<string, Dispatcher>();

/**
 * 根据代理地址获取（或缓存创建）undici dispatcher。
 *
 * Node 内置全局 fetch 无法直接配置代理，需借助 undici 的 ProxyAgent
 * 生成 dispatcher，再通过 fetch 的 `dispatcher` 选项注入。返回 undefined
 * 时 fetch 走默认直连。
 *
 * 每个模型配置独立的 proxy，因此按需创建而非全局注册单一代理。
 */
export function getProxyDispatcher(proxy?: string): Dispatcher | undefined {
  if (!proxy) {
    return undefined;
  }
  let agent = dispatcherCache.get(proxy);
  if (!agent) {
    agent = new ProxyAgent(proxy);
    dispatcherCache.set(proxy, agent);
  }
  return agent;
}

export interface FetchWithProxyOptions extends RequestInit {
  /** HTTP/HTTPS 代理地址，如 http://127.0.0.1:7890。为空则直连 */
  proxy?: string;
}

/**
 * 支持代理的 fetch。proxy 存在时用 undici 的 dispatcher 注入代理，无代理时
 * 直连（走全局 fetch，保持与现有调用 & 测试 mock 兼容）。
 *
 * 注意：有代理时必须用 undici 自己的 fetch，而非 Node 内置 globalThis.fetch。
 * Node 内置 fetch 捆绑的 undici 与 npm 安装的 undici（8.x）版本不一致，两者
 * handler 契约不兼容，把 ProxyAgent dispatcher 塞给内置 fetch 会抛
 * "invalid onRequestStart method"。走代理统一用 undici.fetch，可保证 sender
 * 与 dispatcher 来自同一版本。
 */
export async function fetchWithProxy(
  url: string,
  { proxy, ...rest }: FetchWithProxyOptions = {}
): Promise<Response> {
  const dispatcher = getProxyDispatcher(proxy);

  // 无代理：走全局 fetch（现有测试通过 mock globalThis.fetch 拦截上游）
  if (!dispatcher) {
    return globalThis.fetch(url, rest);
  }

  // 有代理：走 undici fetch + ProxyAgent dispatcher
  const res = await undiciFetch(url, {
    ...rest,
    dispatcher
  } as any);
  // undici 返回的是标准 Response，运行时与全局 Response 一致，仅类型声明不同，
  // 这里断言对齐，避免 DOM lib 与 undici 类型因 body 泛型差异报错。
  return res as unknown as Response;
}
