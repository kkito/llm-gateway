# Anthropic Billing Header Cleaner 拦截器设计

## 背景

Claude Code（VS Code 扩展）会在发往 Anthropic API 的请求中，向 `messages` 数组里 `role: "system"` 的 `content` 最前面注入一段 `x-anthropic-billing-header` 前缀，用于计费跟踪。

当 LLM Gateway 代理 Anthropic 请求时，这段前缀会被透传到上游。由于 LLM Gateway 是统一代理入口，大部分场景不需要（或不希望）保留此头，需要有一个拦截器将其去除。

## 目标

新增一个拦截器 `anthropicBillingCleaner`，在请求发往上游之前，清理 `messages[]` 中 `role: "system"` 的 `content` 里 billing header 前缀。

该拦截器**必须注册为第一个**（优先级最高），确保在所有其他拦截器之前执行。

## 设计

### 触发条件

```typescript
ctx.provider.provider === 'anthropic'
```

且 body 中存在 `messages`（非空数组）。

不检查 `realModel` 是否包含 "claude"，因为只要 provider 类型是 anthropic，body 中的 message 格式就是 Anthropic 格式，billing header 只可能出现在 anthropic 消息中。

### 去除逻辑

使用正则匹配 system content 文本开头的 billing header：

```
/^x-anthropic-billing-header:\s*cc_version=[^;]+;\s*cc_entrypoint=[^;]+;\s*cch=[^;]+;?\s*/i
```

匹配成功则删除匹配部分，剩余的就是正文。

- `i` 标志：大小写不敏感
- `\s*`：允许零或多个空白字符
- `[^;]+`：匹配分号前的值
- `;?`：最后一个 `cch=xxx` 后面的分号可选
- `\s*`：前缀后的空白字符也一并去除

### Content 格式兼容

| 格式 | 处理方式 |
|------|----------|
| `content: string` | 直接对字符串应用正则替换 |
| `content: Array<{ type, text }>` | 遍历每个 block，对 `type === 'text'` 的 block 的 `text` 字段应用正则替换 |

### 不匹配时直接返回

如果任何 system message 的 content 中不包含 billing header，直接返回原 `upstream` 对象（无操作），不做不必要的对象拷贝。

### 不可变性

遵循现有拦截器约定：不修改入参对象，返回新对象（通过 spread / 深拷贝）。

## 文件变更

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/interceptor/anthropic-billing-cleaner.ts` | **新增** | 拦截器实现 |
| `src/interceptor/anthropic-billing-cleaner.test.ts` | **新增** | 拦截器测试 |
| `src/server.ts` | **修改** | 注册拦截器，放在第一位 |

### server.ts 注册代码

```typescript
// !!! 必须放在第一个执行：在 Qwen 缓存和 OpenCode Session 之前清理 billing header
interceptors.use(anthropicBillingCleaner)
interceptors.use(qwenCacheInterceptor)
interceptors.use(opencodeSessionInterceptor)
```

## 测试用例

| 类别 | 用例 |
|------|------|
| **字符串 content** | system content 包含 billing header → 正确去除 |
| **字符串 content** | system content 不包含 billing header → 原样返回 |
| **数组 content** | 数组中有 text block 包含 billing header → 正确去除 |
| **数组 content** | 数组中有多个 text block，第一个包含 billing header → 只处理匹配的 block |
| **数组 content** | 数组中的 text block 不包含 billing header → 原样返回 |
| **触发条件** | provider 不是 anthropic → 直接跳过 |
| **触发条件** | body 中没有 messages → 直接跳过 |
| **触发条件** | messages 数组为空 → 直接跳过 |
| **不可变性** | 不修改原始 upstream 对象 |
| **边界** | billing header 大小写变体 |
| **边界** | cc_version/cc_entrypoint/cch 值包含特殊字符 |
| **边界** | 多个 system message，只有部分包含 billing header |
