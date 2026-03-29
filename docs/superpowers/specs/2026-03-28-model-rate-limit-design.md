# 模型使用限制设计文档

**创建日期**: 2026-03-28  
**状态**: 已批准

---

## 一、需求概述

为 LLM Gateway 的模型配置添加使用限制功能，支持按请求次数、Token 消耗量、API 费用等维度进行限制，可在天、小时、周、月等时间周期内设置阈值，达到限制后返回 429 错误。

### 1.1 参考文档

- [百度千帆速率限制](https://cloud.baidu.com/doc/qianfan/s/imlg0beiu)

---

## 二、配置结构设计

### 2.1 新增类型定义

```typescript
interface ModelLimit {
  type: 'requests' | 'input_tokens' | 'cost';
  period: 'day' | 'hours' | 'week' | 'month';
  periodValue?: number;  // 当 period='hours' 时，指定小时数（如 5 表示最近 5 小时）
  max: number;           // 最大限制值
}

interface ProviderConfig {
  customModel: string;
  realModel: string;
  apiKey: string;
  baseUrl: string;
  provider: ProviderType;
  desc?: string;
  inputPricePer1M?: number;    // 输入 token 每百万价格（美元）
  outputPricePer1M?: number;   // 输出 token 每百万价格（美元）
  cachedPricePer1M?: number;   // 缓存 token 每百万价格（美元）
  limits?: ModelLimit[];       // 使用限制配置
}
```

### 2.2 配置示例

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

---

## 三、系统架构

### 3.1 请求处理流程

```
┌─────────────────────────────────────────────────────────────┐
│                        请求入口                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  1. 解析请求 → 提取 customModel                             │
│  2. 查找模型配置 → 获取 limits 配置                          │
│  3. 检查内存计数器 → 如未加载则从日志读取                    │
│  4. 逐条检查限制                                             │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
     ┌─────────────────┐            ┌─────────────────┐
     │  触发限制        │            │  未触发限制      │
     │  → 返回 429 错误   │            │  → 继续处理请求  │
     │  → 不记录日志     │            │  → 记录正常日志  │
     └─────────────────┘            └─────────────────┘
```

### 3.2 时间周期定义

| 类型 | 说明 | 重置时机 |
|------|------|----------|
| `day` | 今天（0 点到现在） | 每天 0 点重置 |
| `hours` | 最近 N 小时（滑动窗口） | 随时滑动 |
| `week` | 本周（周一到现在） | 每周一 0 点重置 |
| `month` | 本月（1 号到现在） | 每月 1 号 0 点重置 |

---

## 四、核心模块设计

### 4.1 使用限制检查器 (`src/lib/rate-limiter.ts`)

```typescript
interface LimitCheckResult {
  exceeded: boolean;
  limit?: ModelLimit;
  current?: number;
  message?: string;
}

class RateLimiter {
  // 检查所有限制
  checkLimits(config: ProviderConfig, logDir: string): Promise<LimitCheckResult>;
  
  // 计算某个时间范围内的统计
  calculateUsage(config: ProviderConfig, logDir: string, period: Period): Promise<UsageStats>;
  
  // 计算费用
  calculateCost(usage: UsageStats, pricing: Pricing): number;
}
```

### 4.2 用量追踪器 (`src/lib/usage-tracker.ts`)

```typescript
interface ModelUsageCounter {
  model: string;
  lastChecked: number;
  
  today: {
    date: string;
    requests: number;
    inputTokens: number;
    cost: number;
    loaded: boolean;
  };
  
  thisWeek: {
    weekStart: string;
    requests: number;
    inputTokens: number;
    cost: number;
    loaded: boolean;
  };
  
  thisMonth: {
    month: string;
    requests: number;
    inputTokens: number;
    cost: number;
    loaded: boolean;
  };
  
  slidingWindows: Map<number, {
    windowHours: number;
    entries: Array<{
      timestamp: number;
      requests: number;
      inputTokens: number;
      cost: number;
    }>;
    loaded: boolean;
  }>;
}

class UsageTracker {
  // 惰性加载：首次使用时从日志读取
  async ensureLoaded(counter: ModelUsageCounter, period: string, logDir: string): Promise<void>;
  
  // 记录用量（内存 + 异步日志）
  recordUsage(model: string, entry: LogEntry): void;
  
  // 获取当前用量
  getCurrentUsage(counter: ModelUsageCounter, limit: ModelLimit): number;
}
```

### 4.3 时间周期工具 (`src/lib/period-utils.ts`)

```typescript
interface PeriodRange {
  start: string;  // YYYY-MM-DD
  end: string;    // YYYY-MM-DD
  description: string;
}

function getPeriodRange(period: 'day' | 'hours' | 'week' | 'month', periodValue?: number): PeriodRange;
function getTodayDate(): string;           // YYYY-MM-DD
function getWeekStart(): string;           // 本周一的日期
function getMonthStart(): string;          // 本月 1 号
```

### 4.4 费用计算器 (`src/lib/cost-calculator.ts`)

```typescript
interface Pricing {
  inputPricePer1M: number;
  outputPricePer1M: number;
  cachedPricePer1M: number;
}

function calculateCost(
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number,
  pricing: Pricing
): number;
```

---

## 五、错误响应

### 5.1 错误格式

```json
{
  "error": {
    "message": "Rate limit exceeded for model 'gpt-4-turbo': daily request count limit (100) reached",
    "type": "rate_limit_error",
    "param": null,
    "code": "rate_limit_exceeded"
  }
}
```

### 5.2 错误信息模板

- 请求次数：`Rate limit exceeded for model '{model}': {period} request count limit ({max}) reached`
- 输入 Token：`Rate limit exceeded for model '{model}': {period} input token limit ({max}) reached`
- 费用限制：`Rate limit exceeded for model '{model}': {period} cost limit (${max}) reached`

### 5.3 周期描述映射

| Period | 描述 |
|--------|------|
| `day` | daily |
| `hours` (N=5) | last 5 hours |
| `week` | weekly |
| `month` | monthly |

---

## 六、数据流

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

---

## 七、边界情况处理

| 场景 | 处理方式 |
|------|----------|
| 日志文件不存在 | 视为用量为 0，通过检查 |
| 配置中没有 limits | 跳过限制检查 |
| 配置中没有价格但有限制类型为 cost | 返回 500 错误（配置错误） |
| 并发请求 | 基于内存计数器，无竞态条件 |
| 周期切换（天/周/月） | 检测到日期变化后重新从日志加载 |
| 滑动窗口过期数据 | 定期清理（每分钟） |

---

## 八、实现任务分解

1. **类型定义扩展** (`src/config.ts`)
   - 添加 `ModelLimit` 接口
   - 扩展 `ProviderConfig` 添加 `limits`、价格字段

2. **时间周期工具** (`src/lib/period-utils.ts`)
   - 实现日期计算函数
   - 实现周期范围计算

3. **费用计算器** (`src/lib/cost-calculator.ts`)
   - 实现费用计算逻辑

4. **用量追踪器** (`src/lib/usage-tracker.ts`)
   - 实现惰性加载逻辑
   - 实现内存计数器更新
   - 实现滑动窗口管理

5. **限制检查器** (`src/lib/rate-limiter.ts`)
   - 实现限制检查逻辑
   - 实现错误信息生成

6. **路由集成** (`src/routes/chat-completions.ts`, `src/routes/messages.ts`)
   - 在请求处理前调用限制检查
   - 处理 429 错误响应

7. **配置验证**
   - 启动时验证 limits 配置合法性
   - 验证 cost 限制必须配置价格

8. **文档更新**
   - 更新 README 配置说明
   - 添加使用限制示例

---

## 九、测试计划

### 9.1 单元测试

**文件**: `tests/lib/period-utils.test.ts`

测试内容：
- `getTodayDate()` - 返回正确的 YYYY-MM-DD 格式
- `getWeekStart()` - 返回本周一的正确日期
- `getMonthStart()` - 返回本月 1 号的正确日期
- `getPeriodRange('day')` - 返回今日范围
- `getPeriodRange('hours', 5)` - 返回最近 5 小时范围
- `getPeriodRange('week')` - 返回本周范围
- `getPeriodRange('month')` - 返回本月范围

**文件**: `tests/lib/cost-calculator.test.ts`

测试内容：
- 基础费用计算（只有输入 token）
- 基础费用计算（只有输出 token）
- 完整费用计算（输入 + 输出 + 缓存）
- 缓存 token 优惠计算
- 零用量费用计算
- 价格配置缺失时的处理

**文件**: `tests/lib/usage-tracker.test.ts`

测试内容：
- 惰性加载：首次检查时从日志读取
- 内存计数器更新：请求后正确累加
- 周期重置检测：天/周/月切换时重新加载
- 滑动窗口：正确维护最近 N 小时数据
- 滑动窗口清理：过期数据被正确移除
- 多模型隔离：不同模型计数器独立

**文件**: `tests/lib/rate-limiter.test.ts`

测试内容：
- 请求次数限制检查
- 输入 token 限制检查
- 费用限制检查
- 多限制组合检查
- 限制触发时返回正确错误信息
- 无 limits 配置时跳过检查
- cost 限制但缺少价格配置时报错

### 9.2 集成测试

**文件**: `tests/integration/rate-limit-integration.test.ts`

测试内容：
- 完整的请求处理流程
- 限制触发时返回 429 状态码
- 限制触发时不写入日志
- 限制通过后正常调用上游
- 配置热加载后限制立即生效

### 9.3 E2E 测试

**文件**: `tests/e2e/rate-limit.e2e.test.ts`

测试场景：

1. **请求次数限制**
   - 配置每日 100 次限制
   - 发送 100 次请求，全部成功
   - 发送第 101 次请求，返回 429
   - 错误信息包含正确的限制类型和数值

2. **输入 Token 限制**
   - 配置每日 50000 token 限制
   - 发送请求累积输入 token
   - 达到限制后返回 429

3. **费用限制**
   - 配置每月 $500 费用限制
   - 模拟请求累积费用
   - 达到限制后返回 429

4. **滑动窗口限制**
   - 配置最近 5 小时 50 次请求限制
   - 发送请求并等待时间流逝（mock 时间）
   - 验证窗口滑动后计数器正确更新

5. **多限制组合**
   - 同时配置请求次数、token、费用限制
   - 验证任一达到限制即触发 429

6. **周期切换**
   - 配置每日限制
   - Mock 跨天场景
   - 验证新的一天计数器重置

7. **日志 + 内存混合模式**
   - 首次请求从日志加载
   - 后续请求使用内存计数
   - 验证两者数据一致性

### 9.4 性能测试

**文件**: `tests/performance/rate-limiter.perf.test.ts`

测试内容：
- 单次请求延迟 < 10ms（内存检查）
- 首次请求延迟 < 100ms（日志加载）
- 并发 100 请求吞吐量
- 内存占用增长曲线

---

## 十、文档更新

### 10.1 用户文档

**文件**: `docs/user-guide.md`

新增章节 **"模型使用限制"**，包含：

```markdown
## 模型使用限制

LLM Gateway 支持为每个模型配置使用限制，包括请求次数、Token 消耗量和 API 费用等维度。

### 快速开始

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
      "inputPricePer1M": 10.0,
      "outputPricePer1M": 30.0,
      "cachedPricePer1M": 0,
      "limits": [
        { "type": "requests", "period": "day", "max": 100 },
        { "type": "input_tokens", "period": "day", "max": 500000 },
        { "type": "cost", "period": "month", "max": 500 }
      ]
    }
  ]
}
```

### 限制类型

| 类型 | 说明 | 单位 |
|------|------|------|
| `requests` | 请求次数 | 次 |
| `input_tokens` | 输入 Token 数量 | tokens |
| `cost` | API 费用消耗 | 美元 |

### 时间周期

| 周期 | 说明 | 重置时机 |
|------|------|----------|
| `day` | 今天 | 每天 0 点 |
| `hours` | 最近 N 小时 | 滑动窗口 |
| `week` | 本周 | 每周一 0 点 |
| `month` | 本月 | 每月 1 号 0 点 |

### 配置示例

#### 限制每日请求次数

```json
{
  "limits": [
    { "type": "requests", "period": "day", "max": 100 }
  ]
}
```

#### 限制最近 5 小时请求次数

```json
{
  "limits": [
    { "type": "requests", "period": "hours", "periodValue": 5, "max": 50 }
  ]
}
```

#### 限制每日输入 Token

```json
{
  "limits": [
    { "type": "input_tokens", "period": "day", "max": 500000 }
  ]
}
```

#### 限制每月费用

```json
{
  "limits": [
    { "type": "cost", "period": "month", "max": 500 }
  ]
}
```

#### 组合多个限制

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

### 费用计算

费用限制需要配置 Token 单价（每百万 token 的价格，单位：美元）：

```json
{
  "inputPricePer1M": 10.0,    // 输入 token 每百万价格
  "outputPricePer1M": 30.0,   // 输出 token 每百万价格
  "cachedPricePer1M": 0       // 缓存 token 每百万价格（通常更便宜）
}
```

费用计算公式：
```
费用 = (输入 token / 1,000,000 × inputPricePer1M) 
     + (输出 token / 1,000,000 × outputPricePer1M)
     + (缓存 token / 1,000,000 × cachedPricePer1M)
```

### 错误响应

当达到限制时，返回 HTTP 429 错误：

```json
{
  "error": {
    "message": "Rate limit exceeded for model 'gpt-4-turbo': daily request count limit (100) reached",
    "type": "rate_limit_error",
    "param": null,
    "code": "rate_limit_exceeded"
  }
}
```

### 注意事项

1. **惰性加载**: 首次请求时从日志文件加载历史用量，后续请求使用内存计数
2. **周期切换**: 天/周/月切换时自动重新从日志加载
3. **并发安全**: 使用内存计数器，无并发竞态问题
4. **配置热加载**: 修改配置后立即生效
5. **不记录日志**: 被 429 拒绝的请求不写入日志
```

### 10.2 配置字段说明表

在 `docs/user-guide.md` 的配置说明部分添加：

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

### 10.3 常见问题

在 `docs/user-guide.md` 中添加 FAQ：

```markdown
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
```

---

## 十一、后续优化方向

1. **多进程支持**: 使用 Redis 共享计数器
2. **持久化快照**: 定期保存内存计数器到磁盘
3. **LRU 淘汰**: 内存紧张时淘汰长时间未使用的计数器
4. **告警通知**: 达到限制阈值时发送通知
5. **Dashboard 展示**: 在管理界面显示当前用量和限制状态
