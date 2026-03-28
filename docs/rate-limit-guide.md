# 模型使用限制功能

LLM Gateway 支持为每个模型配置使用限制，包括请求次数、Token 消耗量和 API 费用等维度。当达到限制时，系统会返回 HTTP 429 错误。

## 功能概述

- 🎯 **多维度限制**: 支持请求次数、输入 Token、API 费用三种限制类型
- ⏰ **灵活周期**: 支持今天、最近 N 小时、本周、本月四种时间周期
- 📊 **实时检查**: 每个请求都会实时检查限制，达到限制立即返回 429
- 💾 **日志 + 内存**: 首次从日志加载，后续使用内存计数（微秒级检查）
- 🔄 **自动重置**: 周期切换时自动重新加载并重置计数器

## 快速开始

### 基础配置

在配置文件中为模型添加 `limits` 数组：

```json
{
  "models": [
    {
      "customModel": "gpt-4-turbo",
      "realModel": "gpt-4-turbo-2024-04-09",
      "apiKey": "sk-xxx",
      "baseUrl": "https://api.openai.com",
      "provider": "openai",
      "limits": [
        { "type": "requests", "period": "day", "max": 100 }
      ]
    }
  ]
}
```

### 完整配置示例

```json
{
  "models": [
    {
      "customModel": "gpt-4-turbo",
      "realModel": "gpt-4-turbo-2024-04-09",
      "apiKey": "sk-xxx",
      "baseUrl": "https://api.openai.com",
      "provider": "openai",
      "inputPricePer1M": 10.0,
      "outputPricePer1M": 30.0,
      "cachedPricePer1M": 0,
      "limits": [
        { "type": "requests", "period": "day", "max": 100 },
        { "type": "requests", "period": "hours", "periodValue": 5, "max": 50 },
        { "type": "input_tokens", "period": "day", "max": 500000 },
        { "type": "cost", "period": "month", "max": 500 }
      ]
    }
  ]
}
```

## 限制类型

| 类型 | 说明 | 单位 | 配置字段 |
|------|------|------|----------|
| `requests` | 请求次数 | 次 | `type: "requests"` |
| `input_tokens` | 输入 Token 数量 | tokens | `type: "input_tokens"` |
| `cost` | API 费用消耗 | 美元 | `type: "cost"` |

## 时间周期

| 周期 | 说明 | 重置时机 | 配置字段 |
|------|------|----------|----------|
| `day` | 今天（0 点到现在） | 每天 0 点 | `period: "day"` |
| `hours` | 最近 N 小时（滑动窗口） | 随时滑动 | `period: "hours"` + `periodValue` |
| `week` | 本周（周一到现在） | 每周一 0 点 | `period: "week"` |
| `month` | 本月（1 号到现在） | 每月 1 号 0 点 | `period: "month"` |

## 配置示例

### 限制每日请求次数

限制每天最多 100 次请求：

```json
{
  "limits": [
    { "type": "requests", "period": "day", "max": 100 }
  ]
}
```

### 限制最近 N 小时请求次数

限制最近 5 小时最多 50 次请求：

```json
{
  "limits": [
    { "type": "requests", "period": "hours", "periodValue": 5, "max": 50 }
  ]
}
```

### 限制每日输入 Token

限制每天最多输入 50 万 token：

```json
{
  "limits": [
    { "type": "input_tokens", "period": "day", "max": 500000 }
  ]
}
```

### 限制每月费用

限制每月最多消耗 $500：

```json
{
  "limits": [
    { "type": "cost", "period": "month", "max": 500 }
  ]
}
```

### 组合多个限制

同时配置多种限制，任一达到即触发 429：

```json
{
  "limits": [
    { "type": "requests", "period": "day", "max": 100 },
    { "type": "requests", "period": "hours", "periodValue": 5, "max": 50 },
    { "type": "input_tokens", "period": "day", "max": 500000 },
    { "type": "cost", "period": "month", "max": 500 }
  ]
}
```

## 费用计算

费用限制需要配置 Token 单价（每百万 token 的价格，单位：美元）：

```json
{
  "inputPricePer1M": 10.0,    // 输入 token 每百万价格
  "outputPricePer1M": 30.0,   // 输出 token 每百万价格
  "cachedPricePer1M": 0       // 缓存 token 每百万价格（通常更便宜）
}
```

### 费用计算公式

```
费用 = (输入 token / 1,000,000 × inputPricePer1M) 
     + (输出 token / 1,000,000 × outputPricePer1M)
     + (缓存 token / 1,000,000 × cachedPricePer1M)
```

### 示例

假设配置：
- `inputPricePer1M: 10.0`
- `outputPricePer1M: 30.0`
- `cachedPricePer1M: 0`

一次请求消耗：
- 输入 token: 100,000
- 输出 token: 50,000
- 缓存 token: 20,000

费用计算：
```
费用 = (100,000 / 1,000,000 × 10.0) 
     + (50,000 / 1,000,000 × 30.0)
     + (20,000 / 1,000,000 × 0)
     = 1.0 + 1.5 + 0
     = $2.5
```

## 错误响应

当达到限制时，返回 HTTP 429 错误：

```json
{
  "error": {
    "message": "Rate limit exceeded for model 'gpt-4-turbo': Daily request count limit (100) reached",
    "type": "rate_limit_error",
    "param": null,
    "code": "rate_limit_exceeded"
  }
}
```

### 错误信息模板

| 限制类型 | 错误信息模板 |
|----------|-------------|
| 请求次数 | `Rate limit exceeded for model '{model}': {period} request count limit ({max}) reached` |
| 输入 Token | `Rate limit exceeded for model '{model}': {period} input token limit ({max}) reached` |
| 费用 | `Rate limit exceeded for model '{model}': {period} cost limit (${max}) reached` |

### 周期描述

| period | 错误信息中的描述 |
|--------|-----------------|
| `day` | Daily |
| `hours` (N=5) | Last 5 hours |
| `week` | Weekly |
| `month` | Monthly |

## 技术实现

### 日志 + 内存混合方案

```
请求进来时
    ↓
检查内存计数器
    │
    ├── 存在 → 直接使用（O(1)，微秒级）
    │
    └── 不存在 → 从日志读取对应周期数据 → 初始化内存计数器 → 返回结果
```

**特点：**
- 服务启动快（无需预加载）
- 按需加载（只加载用到的模型）
- 周期切换时自动重新加载
- 内存占用低

### 计数器重置

| 周期 | 重置时机 |
|------|----------|
| `day` | 每天 0 点，检测到日期变化后自动重置 |
| `hours` | 滑动窗口，自动过期 |
| `week` | 每周一 0 点，检测到周变化后自动重置 |
| `month` | 每月 1 号 0 点，检测到月变化后自动重置 |

### 数据流

```
请求 → 提取模型 → 读取配置 → 获取 limits
                              │
                              ▼
                    对每个 limit 进行检查:
                    1. 检查内存计数器是否已加载
                    2. 如未加载，读取日志文件并累加
                    3. 从内存计数器获取当前用量
                    4. 对比限制值
                              │
                              ▼
                    任一超过 → 返回 429（不记录日志）
                    全部通过 → 继续处理 → 更新内存计数器 → 异步写日志
```

## 注意事项

1. **配置热加载**: 修改配置文件后立即生效，无需重启服务
2. **不记录日志**: 被 429 拒绝的请求不写入日志，不计入统计
3. **并发安全**: 使用内存计数器，无并发竞态问题
4. **费用限制必需价格**: 配置 `cost` 限制时必须同时配置价格字段
5. **滑动窗口清理**: 后台每分钟清理过期数据，避免内存泄漏

## 配置字段说明

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `limits` | array | ❌ | 使用限制配置数组 |
| `limits[].type` | string | ✅ | 限制类型：`requests` / `input_tokens` / `cost` |
| `limits[].period` | string | ✅ | 时间周期：`day` / `hours` / `week` / `month` |
| `limits[].periodValue` | number | ❌ | 当 `period='hours'` 时指定小时数 |
| `limits[].max` | number | ✅ | 最大限制值 |
| `inputPricePer1M` | number | ❌ | 输入 token 每百万价格（美元），费用限制必需 |
| `outputPricePer1M` | number | ❌ | 输出 token 每百万价格（美元） |
| `cachedPricePer1M` | number | ❌ | 缓存 token 每百万价格（美元） |

## 常见问题

### Q: 达到限制后怎么办？

A: 等待周期结束或滑动窗口滑过，或者调整配置中的限制值。

### Q: 配置修改后多久生效？

A: 配置热加载，修改后立即生效。

### Q: 被 429 拒绝的请求会计入用量吗？

A: 不会，被拒绝的请求不写入日志，不计入统计。

### Q: 服务重启后用量计数会重置吗？

A: 不会，重启后首次请求会从日志文件加载历史用量。

### Q: 如何查看当前用量？

A: 使用 `llm-gateway-stats` 命令查看统计信息。

### Q: 支持多进程部署吗？

A: 当前版本使用内存计数器，仅支持单机部署。多进程部署需要使用 Redis 共享计数器（后续版本支持）。

### Q: 日志文件会无限增长吗？

A: 日志按天切分，建议定期清理旧日志文件。滑动窗口数据会每分钟自动清理过期数据。

## 相关文件

- 类型定义：`src/config.ts`
- 时间周期工具：`src/lib/period-utils.ts`
- 费用计算器：`src/lib/cost-calculator.ts`
- 用量追踪器：`src/lib/usage-tracker.ts`
- 限制检查器：`src/lib/rate-limiter.ts`
- 路由集成：`src/routes/chat-completions.ts`, `src/routes/messages.ts`
