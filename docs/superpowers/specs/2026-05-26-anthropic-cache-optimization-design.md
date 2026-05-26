# Anthropic Cache Optimization — 设计文档

## 背景

llm-gateway 目前已经有 `anthropic-billing-cleaner` 拦截器，用于去除 Claude Code 注入的 `x-anthropic-billing-header` 前缀。但在使用 Anthropic API 时，还有多个影响 prompt cache 命中率的问题未被处理：

- 非确定性块排序导致缓存前缀变化
- `cache_control` 标记位置不稳定
- TTL 未正确注入
- Continue/resume 后的残余文本
- 粘附在 `tool_result` 尾部的 `system-reminder`

参考项目 [claude-code-cache-fix](https://github.com/cnighswonger/claude-code-cache-fix) 的实现，将这些优化以 `UpstreamInterceptor` 的形式接入 llm-gateway。

## 拦截器总览

| # | 拦截器 | 作用域 | 功能 | 来源参考 |
|---|--------|--------|------|----------|
| 已有 | `anthropic-billing-cleaner` | CC 专用 | 去除 billing header 前缀 | 已有实现，新增 URL 守卫 |
| 1 | `claude-code-cache` | CC 专用 | 4 个子步骤：smoosh-split / sort-stabilization / fresh-session-sort / content-strip | claude-code-cache-fix: fresh-session-sort, sort-stabilization, smoosh-split, content-strip |
| 2 | `cache-control-normalize` | Anthropic 通用 | 规范化 cache_control 标记位置 | claude-code-cache-fix: cache-control-normalize |
| 3 | `ttl-management` | Anthropic 通用 | 注入正确 TTL | claude-code-cache-fix: ttl-management |

### URL 守卫

所有 Anthropic 相关的拦截器必须检查 `upstream.url.includes('/v1/messages')`，只有 Anthropic 格式的请求才执行逻辑。

工具函数：`src/interceptor/helpers.ts` → `isAnthropicV1Messages(url: string): boolean`

## 文件变更

### 新增文件

```
src/interceptor/
├── helpers.ts                         # isAnthropicV1Messages() 工具函数
├── claude-code-cache.ts               # CC 专用优化（合并 4 个子步骤）
├── cache-control-normalize.ts         # 通用 cache_control 规范化
└── ttl-management.ts                  # 通用 TTL 管理
```

### 移动文件

从 `src/interceptor/` 迁移到 `tests/interceptor/`（统一测试目录）：

| 原路径 | 目标路径 |
|--------|----------|
| `src/interceptor/anthropic-billing-cleaner.test.ts` | `tests/interceptor/anthropic-billing-cleaner.test.ts` |
| `src/interceptor/index.test.ts` | `tests/interceptor/index.test.ts` |
| `src/interceptor/opencode-session.test.ts` | `tests/interceptor/opencode-session.test.ts` |
| `src/interceptor/qwen-cache.test.ts` | `tests/interceptor/qwen-cache.test.ts` |

### 修改文件

| 文件 | 变更内容 |
|------|----------|
| `src/interceptor/anthropic-billing-cleaner.ts` | `shouldIntercept()` 中追加 `isAnthropicV1Messages(upstream.url)` 守卫 |
| `src/server.ts` | 注册新的 3 个拦截器，调整注册顺序 |
| `AGENT.md` | 更新测试目录说明、拦截器列表、注册顺序 |

### 新增测试文件

```
tests/interceptor/
├── helpers.test.ts                    # isAnthropicV1Messages 测试
├── claude-code-cache.test.ts          # CC 4 个子步骤的 TDD 测试
├── cache-control-normalize.test.ts    # cache_control 规范化测试
├── ttl-management.test.ts             # TTL 注入测试
└── index.test.ts                      # 含拦截器注册顺序测试
```

> 注：`tests/interceptor/index.test.ts` 是从 `src/interceptor/index.test.ts` 移动过来，并在原有测试基础上新增拦截器顺序验证用例。

## 拦截器注册顺序（server.ts）

```
1. anthropic-billing-cleaner     → 最先清理 billing header 前缀
2. claude-code-cache             → 稳定 CC 块结构
3. cache-control-normalize       → 统一 cache_control 标记位置
4. ttl-management                → 注入正确 TTL
5. opencode-session              → 现有，保持不变
6. qwen-cache                    → 现有，保持不变
```

### 顺序说明

- `anthropic-billing-cleaner` 必须先执行，因为 billing header 中的 `cc_version` 指纹会影响后续块检测
- `claude-code-cache` 在 `cache-control-normalize` 之前，因为块的排序/拆分会影响 cache_control 的最终位置
- `cache-control-normalize` 在 `ttl-management` 之前，因为需要先确定哪些块有 cache_control 标记，再注入 TTL 值
- `opencode-session` 和 `qwen-cache` 是独立功能，与 Anthropic cache 优化无依赖关系

## claude-code-cache 内部步骤

单个拦截器内按顺序执行 4 个子步骤：

```
1. smoosh-split        → 将 tool_result.content 尾部粘附的 <system-reminder> 块剥离为独立 text block
2. sort-stabilization  → Skills/Deferred Tools 列表确定性排序
3. fresh-session-sort  → 重启后 system-reminder 块顺序修复
4. content-strip       → 去除 "Continue from where you left off." 尾部 + 书签提醒
```

每个步骤独立检测是否需要处理，不需要则跳过。输出作为下一步输入。

## 各功能实现参考

### smoosh-split

参考 claude-code-cache-fix `smoosh-split` 扩展。检测 `tool_result.content` 字符串尾部是否粘附了 `<system-reminder>...</system-reminder>` 格式的块，如果有则剥离为独立的 `{type: "text", text: ...}` 块，追加到当前 message 的 content 数组中。

### sort-stabilization

参考 claude-code-cache-fix `sort-stabilization` 扩展。在 system-reminder 块中检测 Skills 列表和 Deferred Tools 列表，对列表项进行字母序排序。

### fresh-session-sort

参考 claude-code-cache-fix `fresh-session-sort` 扩展。检测 messages 中是否有从后面 user message 漂移到 `messages[0]` 的 relocatable block（hooks/skills/MCP/deferred-tools），将其移回正确位置。同时检测 `/clear` 残留块（`<local-command-caveat>` 等）。

### content-strip

参考 claude-code-cache-fix 中 `continue-trailer` 和 `bookkeeping-reminder` 的逻辑：
- 移除 content 中值为 `"Continue from where you left off."` 的 text block
- 移除 content 中匹配书签模式的 `<system-reminder>...</system-reminder>` 块（Token usage、USD budget、Remaining conversation turns 等）

### cache-control-normalize

参考 claude-code-cache-fix `cache-control-normalize` 扩展：
1. 去除所有 user message 中 content block 上的 `cache_control` 字段
2. 在最后一个 user message 的最后一个 content block 上添加 `{type: "ephemeral", ttl: "1h"}`

### ttl-management

参考 claude-code-cache-fix `ttl-management` 扩展：
1. 检测请求类型（main / subagent），通过 system 块中是否包含 Agent SDK 前缀判断
2. 在已有 `cache_control.type === "ephemeral"` 但缺少 `ttl` 的块上注入 `ttl` 值
3. 主请求注入 `1h`，subagent 请求注入 `1h`（可配置）

## 测试策略

### 测试目录

所有拦截器测试统一放在 `tests/interceptor/` 目录下，与 `AGENT.md` 中定义的 `tests/<path-to-module>.test.ts` 规则一致。

### TDD 流程

每个新功能严格按 TDD 流程开发：
1. **红** — 先写测试（参考 claude-code-cache-fix 的 `test/` 和 `proxy/extensions/*.mjs`）
2. **绿** — 写最小实现使测试通过
3. **重构** — 优化代码结构（如有必要）

### 测试覆盖

每个测试文件需要覆盖：
- **正常路径**：功能正常生效的情况
- **跳过条件**：不满足触发条件时原样返回
- **边缘情况**：空输入、边界值
- **不可变性**：不修改原始 upstream 对象

### 拦截器顺序测试

在 `tests/interceptor/index.test.ts` 中新增测试，注册所有 6 个拦截器，通过一个「探针拦截器」验证每个拦截器的执行顺序和依赖关系。

## Error Handling

- 所有拦截器遵循 fail-safe 原则：如果检测不到目标结构，返回原对象
- `anthropic-billing-cleaner` 在检测到未知格式的 billing header 时抛出错误（已有，保持不变）
- 其他拦截器不抛出异常，静默跳过

## 参考项目

- [claude-code-cache-fix](https://github.com/cnighswonger/claude-code-cache-fix) v3.6.2
  - `proxy/extensions/fresh-session-sort.mjs` — CC block relocation
  - `proxy/extensions/sort-stabilization.mjs` — Skills/Deferred Tools sorting
  - `proxy/extensions/smoosh-split.mjs` — Smooshed reminder split
  - `proxy/extensions/content-strip.mjs` — Continue trailer + bookkeeping strip
  - `proxy/extensions/cache-control-normalize.mjs` — cache_control normalization
  - `proxy/extensions/ttl-management.mjs` — TTL injection
  - `preload.mjs` — Fingerprint stabilization logic
