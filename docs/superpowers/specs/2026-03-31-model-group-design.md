# Model Group 功能设计文档

## 1. 概述

### 1.1 背景
LLM Gateway 已经支持单个模型的使用限制（limits）配置。当某个模型触发限额时，系统会返回 429 错误。用户希望在多个相同类型的模型之间实现自动故障转移，当一个模型超限时自动使用下一个可用模型。

### 1.2 目标
- 支持配置 `model_group`，将多个模型组织成一个组
- 请求时传递 `model_group` 参数，系统自动选择组内第一个可用的模型
- 预先检查限额（不是等 429 错误才切换）
- 按配置顺序从第一个模型开始检查

### 1.3 非目标
- 不支持负载均衡策略（如轮询、随机）
- 不支持模型组嵌套
- 不支持动态调整组内模型顺序

---

## 2. 配置设计

### 2.1 数据结构

```typescript
/**
 * 模型组配置
 */
export interface ModelGroup {
  name: string;           // 组名，请求时传递的参数
  models: string[];       // 组内模型名称数组（按顺序）
  desc?: string;          // 可选描述
}

export interface ProxyConfig {
  models: ProviderConfig[];
  modelGroups?: ModelGroup[];  // 新增字段
  adminPassword?: string;
  apiKeys?: ApiKey[];
  userApiKeys?: UserApiKey[];
}
```

### 2.2 配置示例

```json
{
  "models": [
    {
      "customModel": "gpt-4-a",
      "realModel": "gpt-4o",
      "apiKey": "sk-xxx",
      "provider": "openai",
      "baseUrl": "https://api.openai.com",
      "limits": [
        {"type": "requests", "period": "day", "max": 10}
      ]
    },
    {
      "customModel": "gpt-4-b",
      "realModel": "gpt-4o",
      "apiKey": "sk-yyy",
      "provider": "openai",
      "baseUrl": "https://api.openai.com",
      "limits": [
        {"type": "requests", "period": "day", "max": 10}
      ]
    },
    {
      "customModel": "gpt-4-c",
      "realModel": "gpt-4o",
      "apiKey": "sk-zzz",
      "provider": "openai",
      "baseUrl": "https://api.openai.com",
      "limits": [
        {"type": "requests", "period": "day", "max": 10}
      ]
    }
  ],
  "modelGroups": [
    {
      "name": "gpt-4-pool",
      "models": ["gpt-4-a", "gpt-4-b", "gpt-4-c"],
      "desc": "GPT-4 模型池，自动故障转移"
    },
    {
      "name": "claude-pool",
      "models": ["claude-sonnet-a", "claude-sonnet-b"],
      "desc": "Claude 模型池"
    }
  ]
}
```

### 2.3 配置验证规则

1. **组名唯一性**：`modelGroups` 数组中不能有重复的 `name`
2. **模型存在性**：组内引用的所有模型必须存在于 `models` 配置中
3. **非空检查**：`models` 数组不能为空
4. **命名规范**：组名只能包含字母、数字、下划线、中划线

---

## 3. 核心功能设计

### 3.1 模块结构

新增 `src/lib/model-group-resolver.ts` 模块：

```typescript
/**
 * Model Group 解析器
 */
export class ModelGroupResolver {
  /**
   * 根据组名解析模型列表
   * @param config Provider 配置数组
   * @param modelGroups ModelGroup 配置数组
   * @param groupName 组名
   * @returns 模型名称数组
   */
  resolveModelGroup(
    config: ProviderConfig[],
    modelGroups: ModelGroup[] | undefined,
    groupName: string
  ): string[];

  /**
   * 查找组内第一个可用的模型
   * @param modelNames 模型名称数组
   * @param config Provider 配置数组
   * @param logDir 日志目录
   * @returns 可用模型信息，包括模型名、Provider 配置、尝试过的模型列表
   * @throws 当所有模型都超限时抛出错误
   */
  findAvailableModel(
    modelNames: string[],
    config: ProviderConfig[],
    logDir: string
  ): Promise<{
    model: string;
    provider: ProviderConfig;
    triedModels: Array<{
      model: string;
      exceeded: boolean;
      message?: string;
    }>;
  }>;
}
```

### 3.2 算法流程

```
findAvailableModel(modelNames, config, logDir):
  triedModels = []
  
  for each modelName in modelNames:
    provider = config.find(p => p.customModel === modelName)
    
    if provider not found:
      triedModels.push({model: modelName, exceeded: false, message: "Not found"})
      continue
    
    result = RateLimiter.checkLimits(provider, logDir)
    
    if result.exceeded:
      triedModels.push({model: modelName, exceeded: true, message: result.message})
      continue
    
    // 找到可用模型
    return {
      model: modelName,
      provider: provider,
      triedModels: triedModels
    }
  
  // 所有模型都不可用
  throw new ModelGroupExhaustedError(triedModels)
```

### 3.3 错误处理

```typescript
/**
 * Model Group 所有模型都超限时的错误
 */
export class ModelGroupExhaustedError extends Error {
  triedModels: Array<{
    model: string;
    exceeded: boolean;
    message?: string;
  }>;
  
  constructor(triedModels: Array<{...}>) {
    super(`All models in group exceeded their limits`);
    this.triedModels = triedModels;
  }
}
```

---

## 4. 路由设计

### 4.1 请求参数

```typescript
// /v1/chat/completions 或 /v1/messages 请求体
interface ChatCompletionRequest {
  model?: string;        // 单个模型（与 model_group 互斥）
  model_group?: string;  // 模型组名（与 model 互斥）
  messages: Message[];
  // ... 其他参数
}
```

### 4.2 参数验证规则

```typescript
function validateModelParams(body: any): void {
  const { model, model_group } = body;
  
  if (model && model_group) {
    throw new Error('model and model_group are mutually exclusive');
  }
  
  if (!model && !model_group) {
    throw new Error('Either model or model_group must be provided');
  }
}
```

### 4.3 处理流程

```
handler(c, endpoint):
  body = await c.req.json()
  
  // 验证参数
  validateModelParams(body)
  
  if body.model_group:
    // Model Group 模式
    modelInfo = ModelGroupResolver.findAvailableModel(
      modelNames: ModelGroupResolver.resolveModelGroup(...),
      config: currentConfig,
      logDir: logDir
    )
    
    provider = modelInfo.provider
    actualModel = modelInfo.model
    
    // 记录日志时包含 modelGroup 信息
    logEntry.modelGroup = body.model_group
    logEntry.actualModel = actualModel
    
  else:
    // 单个模型模式（原有逻辑）
    provider = config.find(p => p.customModel === body.model)
    actualModel = body.model
  
  // 继续原有处理流程...
```

### 4.4 日志记录

**LogEntry 扩展**：
```typescript
interface LogEntry {
  // ... 现有字段
  modelGroup?: string;      // 新增：请求的模型组名
  actualModel?: string;     // 新增：实际使用的模型
  triedModels?: Array<{     // 新增：尝试过的模型列表（详细日志）
    model: string;
    exceeded: boolean;
    message?: string;
  }>;
}
```

**日志输出示例**：
```
📥 [请求] uuid - 模型组：gpt-4-pool - 流式：true
   ✓ 匹配 model_group: gpt-4-pool -> [gpt-4-a, gpt-4-b, gpt-4-c]
   ⚠️  [跳过] gpt-4-a - 触发限额：Daily request count limit (10) reached
   ✓ 使用模型：gpt-4-b
```

---

## 5. Admin 管理界面设计

### 5.1 页面结构

```
src/admin/routes/
├── model-groups.tsx      # 新增：Model Group 管理
├── model-group-form.tsx  # 新增：新增/编辑表单
└── models.tsx            # 修改：添加导航链接
```

### 5.2 Model Groups 列表页

**功能**：
- 展示所有 Model Group
- 显示：组名、包含模型数量、描述
- 操作：编辑、删除

**UI 布局**：
```
┌─────────────────────────────────────────────┐
│ Model Groups                    [+ 新增]    │
├─────────────────────────────────────────────┤
│ 组名          │ 模型数 │ 描述      │ 操作   │
├─────────────────────────────────────────────┤
│ gpt-4-pool    │   3    │ GPT-4 池  │ 编辑 删除│
│ claude-pool   │   2    │ Claude 池 │ 编辑 删除│
└─────────────────────────────────────────────┘
```

### 5.3 新增/编辑表单

**字段**：
- 组名（必填，唯一）
- 模型选择（多选，从现有 models 中选择）
- 描述（可选）

**UI 布局**：
```
┌─────────────────────────────────────────────┐
│ 新增 Model Group                            │
├─────────────────────────────────────────────┤
│ 组名：[________________]                    │
│                                             │
│ 模型：                                      │
│ ☐ gpt-4-a                                   │
│ ☐ gpt-4-b                                   │
│ ☐ gpt-4-c                                   │
│ ☐ claude-sonnet                             │
│                                             │
│ 描述：[________________]                    │
│                                             │
│            [取消]  [保存]                   │
└─────────────────────────────────────────────┘
```

### 5.4 API 端点

```typescript
// GET /admin/model-groups - 列表页
// GET /admin/model-groups/new - 新增表单
// GET /admin/model-groups/:name/edit - 编辑表单
// POST /admin/api/model-groups - 创建
// PUT /admin/api/model-groups/:name - 更新
// DELETE /admin/api/model-groups/:name - 删除
```

---

## 6. 测试设计

### 6.1 单元测试

**文件**：`src/lib/model-group-resolver.test.ts`

**测试用例**：
```typescript
describe('ModelGroupResolver', () => {
  describe('resolveModelGroup', () => {
    it('should return model names from group', () => {...});
    it('should throw error when group not found', () => {...});
    it('should throw error when modelGroups is undefined', () => {...});
  });

  describe('findAvailableModel', () => {
    it('should return first available model', async () => {...});
    it('should skip exceeded models', async () => {...});
    it('should throw when all models exceeded', async () => {...});
    it('should handle missing model config', async () => {...});
  });
});
```

### 6.2 E2E 测试

**文件**：`tests/e2e/model-group.e2e.test.ts`

**测试用例**：
```typescript
describe('Model Group E2E', () => {
  it('should use first available model in group', async () => {...});
  
  it('should skip to next model when first exceeded', async () => {
    // 1. 配置 model group，包含 2 个模型
    // 2. 手动设置第一个模型已超限
    // 3. 发送 model_group 请求
    // 4. 验证使用了第二个模型
  });
  
  it('should return 429 when all models exceeded', async () => {
    // 1. 配置 model group
    // 2. 设置所有模型都已超限
    // 3. 发送请求
    // 4. 验证返回 429
  });
  
  it('should reject both model and model_group params', async () => {...});
  it('should reject neither model nor model_group params', async () => {...});
});
```

### 6.3 配置验证测试

**文件**：`tests/lib/model-group-config.test.ts`

**测试用例**：
```typescript
describe('ModelGroup Config Validation', () => {
  it('should validate modelGroups array format', () => {...});
  it('should validate group name uniqueness', () => {...});
  it('should validate model references exist', () => {...});
  it('should validate non-empty models array', () => {...});
});
```

---

## 7. 文件清单

### 7.1 新增文件

| 文件路径 | 说明 |
|---------|------|
| `src/lib/model-group-resolver.ts` | Model Group 核心解析逻辑 |
| `src/lib/model-group-resolver.test.ts` | 单元测试 |
| `src/admin/routes/model-groups.tsx` | Model Group 列表页 |
| `src/admin/routes/model-group-form.tsx` | 新增/编辑表单 |
| `tests/e2e/model-group.e2e.test.ts` | E2E 测试 |
| `tests/lib/model-group-config.test.ts` | 配置验证测试 |

### 7.2 修改文件

| 文件路径 | 修改内容 |
|---------|---------|
| `src/config.ts` | 新增 ModelGroup 接口、验证逻辑 |
| `src/logger.ts` | LogEntry 新增 modelGroup、actualModel 字段 |
| `src/routes/chat-completions.ts` | 支持 model_group 参数处理 |
| `src/routes/messages.ts` | 支持 model_group 参数处理 |
| `src/admin/routes/models.tsx` | 添加 Model Groups 导航链接 |
| `src/admin/views/models.tsx` | 可能需要更新视图类型 |

---

## 8. 边界情况处理

### 8.1 配置相关

| 情况 | 处理方式 |
|-----|---------|
| 组内模型不存在于 models 配置 | 配置加载时报错，阻止启动 |
| 组名为空或重复 | 配置加载时报错 |
| modelGroups 字段不存在 | 视为空数组，只支持单个模型模式 |
| 组内 models 数组为空 | 配置加载时报错 |

### 8.2 运行时相关

| 情况 | 处理方式 |
|-----|---------|
| 请求的 model_group 不存在 | 返回 404，错误信息 "Model group not found" |
| model 和 model_group 同时传 | 返回 400，错误信息 "mutually exclusive" |
| 都不传 | 返回 400，错误信息 "Either model or model_group must be provided" |
| 所有模型都超限 | 返回 429，错误信息包含所有尝试过的模型 |
| 组内部分模型配置不存在 | 跳过该模型，继续尝试下一个 |

---

## 9. 性能考虑

1. **限额检查缓存**：`RateLimiter.checkLimits()` 已经使用了 UsageTracker 缓存，不会每次都读取日志文件
2. **顺序检查**：按顺序检查模型，找到第一个可用的就返回，不会检查剩余模型
3. **配置热加载**：支持配置热加载，修改 modelGroups 后自动生效

---

## 10. 向后兼容性

1. **配置兼容**：`modelGroups` 是可选字段，旧配置仍然有效
2. **API 兼容**：原有的 `model` 参数使用方式不变
3. **日志兼容**：新增字段是可选的，不影响现有日志分析

---

## 11. 使用示例

### 11.1 配置

```json
{
  "models": [
    {
      "customModel": "gpt-4-primary",
      "realModel": "gpt-4o",
      "apiKey": "sk-primary-xxx",
      "provider": "openai",
      "baseUrl": "https://api.openai.com",
      "limits": [{"type": "requests", "period": "day", "max": 100}]
    },
    {
      "customModel": "gpt-4-backup",
      "realModel": "gpt-4o",
      "apiKey": "sk-backup-yyy",
      "provider": "openai",
      "baseUrl": "https://api.openai.com",
      "limits": [{"type": "requests", "period": "day", "max": 50}]
    }
  ],
  "modelGroups": [
    {
      "name": "gpt-4-failover",
      "models": ["gpt-4-primary", "gpt-4-backup"],
      "desc": "主备模式，主模型超限时自动切换到备用"
    }
  ]
}
```

### 11.2 请求

```bash
# 使用模型组
curl http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model_group": "gpt-4-failover",
    "messages": [{"role": "user", "content": "Hello"}]
  }'

# 使用单个模型（原有方式）
curl http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4-primary",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

### 11.3 日志输出

```
📥 [请求] 550e8400 - 模型组：gpt-4-failover - 流式：false
   ✓ 匹配 model_group: gpt-4-failover -> [gpt-4-primary, gpt-4-backup]
   ⚠️  [跳过] gpt-4-primary - 触发限额：Daily request count limit (100) reached
   ✓ 使用模型：gpt-4-backup
   ✓ 匹配 provider: gpt-4-backup -> gpt-4o (openai)
   📤 [Proxy 转发] https://api.openai.com/v1/chat/completions
   📤 [响应] 状态码：200
```

---

## 12. 验收标准

- [ ] 配置支持 `modelGroups` 字段
- [ ] 配置验证：组名唯一、模型存在性、非空检查
- [ ] 路由支持 `model_group` 参数
- [ ] 参数互斥验证：model 和 model_group 不能同时存在
- [ ] 按顺序检查限额，找到第一个可用模型
- [ ] 所有模型超限时返回 429
- [ ] 日志记录 modelGroup 和 actualModel
- [ ] Admin 管理界面：列表、新增、编辑、删除
- [ ] 单元测试覆盖率 > 80%
- [ ] E2E 测试通过
