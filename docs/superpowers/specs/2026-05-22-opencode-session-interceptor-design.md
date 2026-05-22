---

# Opencode Session 拦截器 — 设计文档

## 背景

OpenCode CLI 对某些模型服务（如 kimi、glm、mino 等，运行在 opencode.ai 上）要求请求头 `x-opencode-session` 和请求体 `prompt_cache_key` 来维持会话亲和性。

需要为这类请求自动注入上述字段，且 session 需按客户端 IP 独立管理、有过期机制。

参考：`try/cache/using_extra_header` 分支上的 session ID 生成逻辑和 `prompt_cache_key` 用法。

---

## 设计

### 1. 触发条件

拦截器对每个上游请求做如下判断，**所有条件同时满足**才生效：

1. **`ctx.provider.baseUrl`** 转为小写后包含子串 `"opencode.ai"`
2. **`ctx.provider.realModel`** 转为小写后包含以下任一子串：`"kimi"`、`"glm"`、`"mino"`

不满足时直接返回 `upstream` 不做任何修改。

### 2. 行为

当条件触发时：

- **Header**：在 `upstream.headers` 中添加 `x-opencode-session: <sessionId>`
- **Body**：在 `upstream.body` 中添加 `prompt_cache_key: <sessionId>`

两个字段使用相同的 session ID，确保服务端能关联请求。

### 3. Session 管理

#### 3.1 Session ID 格式

参考分支的生成方式：

```
ses_<12hex时间戳><14base62随机字符>
```

- `ses_`：固定前缀
- 时间戳：将 `Date.now()` 与请求计数器编码为 12 hex 字符，使用 descending 方向（`~now`）排序，使新 session 在字典序上排在前面
- 随机字符：14 字节随机数，经 base64url 编码后取字母数字字符，截取 14 位

#### 3.2 存储结构

拦截器内部维护一个 `Map<string, SessionEntry>`，key 为客户端 IP 字符串。

```typescript
interface SessionEntry {
  sessionId: string
  expiresAt: number  // 过期时间戳，ms
}
```

#### 3.3 生命周期

- **创建**：首次检测到某个 IP 的请求时，生成新 session，`expiresAt = Date.now() + 10 * 60 * 1000`
- **复用**：同 IP 后续请求，若 `expiresAt > Date.now()`，直接复用
- **过期**：`expiresAt <= Date.now()` 时，重新生成并更新过期时间
- **续期**：每次命中时，将 `expiresAt` 刷新为 `Date.now() + 10 * 60 * 1000`（滑动窗口）

#### 3.4 过期清理

惰性清理策略：
- 每次操作 Map 时（读/写），随机检查并移除已过期的条目
- 避免定时器开销，适合低频到中频的请求场景

### 4. 不可变原则

遵循 Interceptor 框架的设计约定：**不修改入参对象**，始终返回新对象（Spread）。

```typescript
return {
  ...upstream,
  headers: { ...upstream.headers, 'x-opencode-session': sessionId },
  body: { ...upstream.body, prompt_cache_key: sessionId }
}
```

### 5. 文件结构

```
src/interceptor/
├── opencode-session.ts       # 新增：Opencode Session 拦截器
├── opencode-session.test.ts  # 新增：单元测试
├── index.ts                  # 已有，不变
├── qwen-cache.ts             # 已有，不变
├── qwen-cache.test.ts        # 已有，不变
└── types.ts                  # 已有，不变
```

#### 5.1 `opencode-session.ts` 导出

```typescript
import type { UpstreamInterceptor } from './types.js'

/**
 * 为 opencode.ai 上的 kimi/glm/mino 模型自动注入
 * x-opencode-session header 和 prompt_cache_key body 的拦截器。
 *
 * Session 按客户端 IP 独立管理，10 分钟滑动过期。
 */
export const opencodeSessionInterceptor: UpstreamInterceptor = async (upstream, ctx) => { /* ... */ }

// 内部不导出：generateOpenCodeId、SessionEntry、sessionMap
```

### 6. 注册方式

在 `src/server.ts` 中现有拦截器注册位置追加：

```typescript
import { opencodeSessionInterceptor } from './interceptor/opencode-session.js'
interceptors.use(opencodeSessionInterceptor)
```

当前已经有一个 `qwenCacheInterceptor` 按此方式注册，风格保持一致。

### 7. 测试覆盖

新建 `src/interceptor/opencode-session.test.ts`，覆盖以下场景：

| 类别 | 测试场景 | 预期 |
|------|----------|------|
| 触发条件 | baseUrl 不含 opencode.ai | 原样返回 |
| 触发条件 | baseUrl 含 opencode.ai 但 model 不匹配 | 原样返回 |
| 触发条件 | baseUrl 含 opencode.ai + model 含 kimi | 注入 header + body |
| 触发条件 | baseUrl 含 opencode.ai + model 含 glm | 注入 header + body |
| 触发条件 | baseUrl 含 opencode.ai + model 含 mino | 注入 header + body |
| 触发条件 | 大小写不敏感（OPenCode.AI / KIMI） | 注入 header + body |
| Session | session ID 格式正确 `ses_` + 26 字符 | 匹配正则 `^ses_[a-f0-9]{12}[a-zA-Z0-9]{14}$` |
| Session | 同 IP 复用 session | 两次请求 session ID 相同 |
| Session | 不同 IP 不同 session | session ID 不同 |
| Session | 10 分钟后过期重新生成 | 过期后 session ID 变化 |
| 注入 | header 和 body 都被正确注入 | 检查 upstream 返回值 |

---

## 注意事项

1. **Session 不持久化**：进程重启后所有 session 失效，这是可接受的行为。
2. **不依赖外部存储**：session Map 是模块级变量，仅在拦截器内部管理。
3. **不与 Qwen 缓存冲突**：独立的拦截器，按注册顺序依次执行，互不干扰。
4. **`generateOpenCodeId` 的 `Buffer` 依赖**：Node.js 内置 `buffer` 模块，无需额外安装。
