# OpenCode Session 全模型 + 指纹优化设计（2026-09-04）

## 背景

`src/interceptor/opencode-session.ts` 现只对 `realModel` 含 kimi/glm 的请求加
`x-opencode-session` / `prompt_cache_key`，且 session 池只按客户端 IP 区分。
本次改为全模型覆盖，并用多维指纹替代纯 IP key。

## 设计

### 1. 触发条件：只看域名

去掉 `TARGET_MODELS`，`shouldIntercept` 仅判断 `baseUrl` 含 `opencode.ai`。
命中则统一加 `x-opencode-session` + `prompt_cache_key`。

### 2. Session key：三档（按你的原话）

- 第 1 档：客户端请求头里有 `session-id` 或名含 `session` 的字段（黑名单跳过
  `authorization/cookie/set-cookie/apikey/*token*`，取首个非空值 trim），
  用 `session头值 + 远程IP + user + realModel` 做 key 材料。
- 第 2 档：无 session 类 header，但有 `x-stainless-*`（lang/package-version/
  runtime/runtime-version），用 `stainless拼接 + 远程IP + user-agent + user + realModel`。
- 第 3 档：stainless 也没有，直接 `远程IP + user-agent + user + realModel`。
- user 指 `ctx.currentUser?.name ?? ''`，有则混入，匿名留空不断流；
  realModel 取 `ctx.provider.realModel`（小写归一）。
- 三档材料统一 `sha256` 后作为指纹，只存 hash 不存明文。

### 3. Session 池

- `Map<fingerprint, {sessionId, expiresAt}>`，fingerprint 已含 realModel，
  同一指纹不同模型自然不串缓存，无需额外隔离层。
- TTL 20 分钟滑动续期；保留现有惰性清理（每次操作顺带清 50 个过期项）。

### 4. 出站 UA 统一

- `providers/openai.ts` 和 `providers/anthropic.ts` 的 `buildHeaders()` 加
  `'User-Agent': 'kkito-llm-agent/<VERSION>'`，
  VERSION 复用 `src/lib/version.ts`（从 package.json 读，不硬编码）。
- 三条路由（chat/responses/messages）× 流式/非流式/透传一次性全覆盖。

## 风险

- R1 跨模型缓存污染 → 已用 model 隔离解决。
- R2 stainless 无区分度 → 只当弱信号，不单独成档。
- R3 误扫认证头 → 黑名单排除。
- R4 UA 全局变更 → 接受（用户确认改全局）。

## 测试

- 有 session 头 / 无头匿名 / 同 IP 不同 user / 不同模型同指纹 / TTL 续期，
  复用既有 `opencode-session` 单测文件扩展。
