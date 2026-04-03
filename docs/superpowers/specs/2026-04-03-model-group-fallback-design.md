# Model Group 自动重试 fallback 设计文档

## 概述

当使用 Model Group 发起请求时，如果某个模型返回非 2xx 错误（如 416、500 等），自动尝试组内下一个可用模型，直到成功或所有模型都失败。

## 需求

### 功能需求
- ✅ **重试触发条件**: 上游返回非 2xx 状态码（包括 4xx 和 5xx）
- ✅ **不重试场景**: 流式请求**已经开始传输后**中途出错（无法重试，因为数据已开始传输）
- ✅ **全部失败行为**: 返回最后一个模型的错误响应
- ✅ **日志记录**: 详细记录每个模型的尝试情况（状态码、错误信息）

### 非功能需求
- 保持现有行为向后兼容
- 不引入显著的性能开销
- 错误信息清晰，便于调试

## 架构设计

### 核心流程

```
model_group 请求
    ↓
resolveModelGroup → 获取模型列表 [model1, model2, model3]
    ↓
[重试循环开始]
    ↓
遍历每个模型:
  1. 检查频率限制 → 跳过如果超出
  2. fetch 请求上游
  3. response.ok?
     → Yes: 处理响应（流式/非流式）并返回
     → No: 记录错误 → 还有下一个模型？
       → Yes: 继续下一个
       → No: 返回最后一个错误
[重试循环结束]
```

### 关键判断逻辑

| 场景 | response.ok | 流式传输中 | 行为 |
|------|------------|-----------|------|
| 上游返回 416/500 等 | false | N/A | ✅ 重试下一个 |
| 上游成功开始流式 | true | 中途出错 | ❌ 不重试（无法回退） |
| 上游成功返回非流式 | true | N/A | ✅ 已成功，无需重试 |

## 实现方案

### 1. 修改文件

- `src/routes/chat-completions.ts` - 添加重试循环逻辑
- `src/routes/messages.ts` - 添加重试循环逻辑
- `tests/routes/model-group-fallback.test.ts` - 新增测试文件（TDD 先行）

### 2. 核心代码结构

```typescript
// 伪代码示意
if (model_group) {
  const resolver = new ModelGroupResolver();
  const modelNames = resolver.resolveModelGroup(...);
  
  let lastErrorResponse = null;
  let lastErrorStatus = 500;
  
  for (const modelName of modelNames) {
    // 获取 provider
    const provider = currentConfig.models.find(p => p.customModel === modelName);
    if (!provider) {
      triedModels.push({ model: modelName, exceeded: false, message: 'Model not found' });
      continue;
    }
    
    // 检查频率限制
    const limitResult = await rateLimiter.checkLimits(provider, logDir);
    if (limitResult.exceeded) {
      triedModels.push({ model: modelName, exceeded: true, message: limitResult.message });
      continue;
    }
    
    // 发送请求
    const response = await fetch(upstreamUrl, {...});
    
    if (response.ok) {
      // 成功：处理响应
      actualModel = modelName;
      return processResponse(response, stream, ...);
    }
    
    // 失败：记录错误，继续下一个
    lastErrorResponse = await cloneErrorResponse(response);
    lastErrorStatus = response.status;
    triedModels.push({ model: modelName, exceeded: false, message: `HTTP ${response.status}` });
  }
  
  // 所有模型都失败
  return c.json(lastErrorResponse, lastErrorStatus);
}
```

### 3. 日志记录增强

`triedModels` 字段示例：
```json
{
  "triedModels": [
    { "model": "gpt-4", "exceeded": false, "message": "HTTP 416" },
    { "model": "claude-3", "exceeded": false, "message": "HTTP 500" },
    { "model": "gpt-3.5", "exceeded": true, "message": "Rate limit exceeded" }
  ]
}
```

## TDD 测试策略

### 测试用例

1. **非流式 - 第一个模型 416，第二个成功**
   - Mock: model1 → 416, model2 → 200
   - 断言: 返回 200，triedModels 包含两个模型

2. **非流式 - 所有模型都失败，返回最后一个错误**
   - Mock: model1 → 416, model2 → 500
   - 断言: 返回 500，body 是 model2 的错误

3. **流式 - 上游返回 416，重试下一个模型**
   - Mock: model1 → 416, model2 → 200 (stream)
   - 断言: 返回流式响应

4. **非流式 - 第一个模型频率限制，第二个成功**
   - Mock: model1 rate limited, model2 → 200
   - 断言: 跳过 model1，使用 model2

5. **非流式 - 416 + 频率限制 + 成功，验证复杂场景**
   - Mock: model1 → 416, model2 rate limited, model3 → 200
   - 断言: 跳过 model1 和 model2，使用 model3

### 测试文件位置

`tests/routes/model-group-fallback.test.ts`

## 风险与注意事项

### 风险
1. **重试延迟**: 多个模型依次重试可能增加总耗时
2. **错误响应克隆**: 需要正确克隆响应体以便重试时使用

### 缓解措施
1. 在日志中记录重试总耗时
2. 使用 `response.clone()` 确保响应体可多次读取

## 后续改进方向

- 可配置的重试策略（如只重试 5xx，跳过 4xx）
- 重试间隔延迟（避免快速重试）
- 基于错误类型的智能重试（如 416 可能是请求格式问题，重试无意义）
