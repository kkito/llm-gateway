---

# Qwen 上下文缓存拦截器 — 设计文档

## 背景

阿里云百炼（Model Studio）为 Qwen 系列模型提供了上下文缓存功能（Context Cache），通过在请求 body 的特定位置插入 `"cache_control": {"type": "ephemeral"}` 标记，可以大幅降低重复上下文场景下的输入 Token 费用。

不同模型提供商/模型有不同的缓存触发方式。本文档利用已实现的 UpstreamInterceptor 框架，为 Qwen 模型实现一套自动注入缓存标记的拦截器。

### 相关文档

- [阿里云百炼 - 上下文缓存](https://help.aliyun.com/zh/model-studio/context-cache)
- [Upstream Interceptor 框架设计](https://github.com/kkito/llm-gateway/blob/dev/docs/superpowers/specs/2026-05-22-upstream-interceptor-design.md)

---

## 设计

### 1. 触发条件

拦截器仅在以下条件全部满足时执行缓存处理：

- **`ctx.provider.realModel`** 转为小写后包含子串 `"qwen"`
- **`upstream.body`** 中存在 `messages` 数组（非空）

不满足条件时直接返回上游请求对象，不做任何修改。

### 2. 缓存标记注入规则

阿里云文档规定单次请求最多**4 个 `cache_control` 标记**。拦截器按以下优先级依次注入，累计不超过 4 个：

| 优先级 | 注入位置 | 标记数 | 说明 |
|--------|----------|--------|------|
| 1 | `tools` 数组的最后一条 | 1 | 函数/工具定义的最后一条 |
| 2 | `messages` 数组的最后一条，在其 `content[0]` 上 | 1 | 用户或助手的最后一条消息 |
| 3 | `messages` 中 `role === "system"` 的消息，按顺序 | 每个 system 1 个 | 最多 N 条，N = 4 - 已用标记数 |

**优先级逻辑**：先处理 tools（1 个），再处理 messages 最后一条（1 个），然后将剩余配额分配给 system messages。例如：
- 有 tools：已用 1→system 最多 3 条
- 有 tools + 有 messages：已用 2→system 最多 2 条
- 无 tools：已用 0→system 最多 4 条

#### 2.1 规则 1：tools 最后一条

```json
// 修改前
{
  "tools": [
    { "type": "function", "function": { "name": "get_weather", ... } },
    { "type": "function", "function": { "name": "get_time", ... } }
  ]
}

// 修改后
{
  "tools": [
    { "type": "function", "function": { "name": "get_weather", ... } },
    { "type": "function", "function": { "name": "get_time", ... }, "cache_control": { "type": "ephemeral" } }
  ]
}
```

**注意**：阿里云文档指出 tools 上的 cache_control 标记可能会被忽略，但我们保留此规则以兼容未来行为，且不影响功能。

#### 2.2 规则 2：messages 最后一条

取 `messages` 数组的最后一条，在其 `content` 字段的第一个元素上添加 `cache_control`。

```json
// 修改前
{ "role": "user", "content": [{ "type": "text", "text": "你好" }] }

// 修改后
{ "role": "user", "content": [{ "type": "text", "text": "你好", "cache_control": { "type": "ephemeral" } }] }
```

**要求**：`messages` 非空且最后一条存在 `content`（content 需为数组或字符串）。

#### 2.3 规则 3：system messages

遍历 `messages` 中所有 `role === "system"` 的消息，按顺序逐条处理，直到标记数达到上限。

**content 格式适配**：

- 如果 `content` 是 **string**：转为数组格式，在数组中第一个（也是唯一一个）元素上加 `cache_control`

```json
// 修改前
{ "role": "system", "content": "You are a helpful assistant." }

// 修改后
{ "role": "system", "content": [{ "type": "text", "text": "You are a helpful assistant.", "cache_control": { "type": "ephemeral" } }] }
```

- 如果 `content` 是 **数组**：在数组中最后一个 `type === "text"` 的 block 上加 `cache_control`

```json
// 修改前
{ "role": "system", "content": [
  { "type": "text", "text": "第一部分" },
  { "type": "text", "text": "第二部分" }
] }

// 修改后
{ "role": "system", "content": [
  { "type": "text", "text": "第一部分" },
  { "type": "text", "text": "第二部分", "cache_control": { "type": "ephemeral" } }
] }
```

**边界处理**：
- 无 text block 的 content 数组（如仅有 `type: "image_url"`）：跳过该条 system，不计入标记数
- content 为空数组：跳过

### 3. 标记计数逻辑

拦截器内部维护一个 `cacheControlCount` 计数器，每次成功添加 `cache_control` 后递增。处理顺序固定：

```
cacheControlCount = 0

→ 处理 tools（增加 1）
→ 处理 messages 最后一条（增加 1）
→ 遍历 system messages（逐条增加，直到 count → 4）
```

如果某步骤因条件不满足（如无 tools、无 messages、无 system messages）跳过，对应的配额自动让给后续步骤。

### 4. 不可变原则

遵循 Interceptor 框架的设计约定：**不修改入参对象**，始终返回新对象（Spread / 深拷贝）。

具体实现时使用结构化的辅助函数，每个函数接收部分 body 并返回修改后的部分，最后组装成完整的 `UpstreamRequest`。

### 5. 文件结构

```
src/interceptor/
├── types.ts           # （已有）
├── index.ts           # （已有）
├── index.test.ts      # （已有）
├── qwen-cache.ts      # 新增：Qwen 缓存拦截器实现
└── qwen-cache.test.ts # 新增：单元测试
```

#### 5.1 `qwen-cache.ts` 导出

```typescript
import type { UpstreamInterceptor } from './types.js'

/**
 * 为 Qwen 系列模型自动注入上下文缓存标记的拦截器。
 *
 * 触发条件：
 * - realModel 小写后包含 "qwen"
 * - body 中存在非空的 messages 数组
 *
 * 缓存规则：
 * 1. tools 最后一条 + cache_control
 * 2. messages 最后一条 content[0] + cache_control
 * 3. system messages 逐条 + cache_control
 * 总计不超过 4 个标记。
 */
export const qwenCacheInterceptor: UpstreamInterceptor = async (upstream, ctx) => {
  // ...
}

// 辅助函数用于测试
export function addCacheControlToTools(tools: any[]): any[]
export function addCacheControlToLastMessage(messages: any[]): any[]
export function addCacheControlToSystemMessages(messages: any[], quota: number): any[]
export function ensureContentArray(content: any): any[]
export function addCacheControlToLastTextBlock(blocks: any[]): any[]
```

### 6. 注册方式

修改入口文件或 `config` 加载逻辑，在服务器启动时注册该拦截器：

```typescript
import { interceptors } from './interceptor/index.js'
import { qwenCacheInterceptor } from './interceptor/qwen-cache.js'

// 注册 Qwen 缓存拦截器
interceptors.use(qwenCacheInterceptor)
```

具体注册位置将在实现计划中确定（可能在 `src/server.ts` 或 `src/index.ts`）。

### 7. 测试覆盖

新建 `src/interceptor/qwen-cache.test.ts`，覆盖以下场景：

| 类别 | 测试场景 | 预期 |
|------|----------|------|
| 触发条件 | realModel 不含 qwen | 原样返回，不处理 |
| 触发条件 | body 无 messages | 原样返回，不处理 |
| 触发条件 | messages 为空数组 | 原样返回，不处理 |
| 规则 1 | 有 tools，在最后一条上加标记 | tools 最后一条有 cache_control |
| 规则 1 | 无 tools 字段 | 跳过，不影响其他规则 |
| 规则 2 | messages 有 3 条，最后一条 content 有标记 | 仅最后一条受影响 |
| 规则 2 | messages 最后一条 content 是 string | 转数组再标记 |
| 规则 3 | 一条 system（content 为 string） | 转数组 + 标记 |
| 规则 3 | 一条 system（content 为数组） | 最后一个 text block + 标记 |
| 规则 3 | 多条 system，配额充足 | 全部加标记 |
| 规则 3 | 多条 system，配额不足 2 个 | 只加前 2 条 |
| 组合 | tools + messages + 2 system | 共 4 个标记 |
| 组合 | tools + messages + 3 system（超 4） | 只前 2 条 system 加标记 |
| 边界 | system content 是空数组 | 跳过，不计入标记数 |
| 边界 | system content 数组无 text block | 跳过，不计入标记数 |

---

## 注意事项

1. **拦截器应保持幂等**：多次执行同一拦截器不应产生不同结果（当前实现通过检查 `cache_control` 已存在来跳过，但一般场景不会重复执行同一拦截器）。
2. **性能**：拦截器仅涉及少量数组遍历和对象复制，对请求延迟影响可忽略。
3. **其他模型**：当前仅处理 Qwen。其他模型（如 DeepSeek 也支持隐式缓存）可通过注册新的拦截器实现，与本文档无关。
4. **`tools` 标记被忽略**：阿里云文档指出 tools 上的 cache_control 会被忽略，但我们保留此规则——不影响功能，且可能在未来版本的 API 中生效。
