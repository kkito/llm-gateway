# Admin 后台模型使用限制配置设计

**创建日期**: 2026-03-28
**状态**: 已批准

---

## 一、需求概述

为 LLM Gateway 的 admin 后台添加模型使用限制配置功能，让用户可以通过 Web 界面配置和管理模型的价格信息和使用限制。

### 1.1 背景

核心速率限制功能已在 `src/lib/rate-limiter.ts` 等模块中实现，但 admin 后台的配置表单尚未添加相应的编辑界面。用户目前只能通过直接编辑 JSON 配置文件来设置价格和限制。

### 1.2 目标

- 在 admin 模型表单中添加价格配置字段
- 在 admin 模型表单中添加使用限制（limits）配置功能
- 提供用户友好的动态表单，默认折叠隐藏
- 前端验证：cost 类型限制必须配置价格

---

## 二、UI 设计

### 2.1 模型表单布局

```
┌─────────────────────────────────────────────────────┐
│ 自定义模型名称：[my-gpt4]                            │
│ 实际模型名称：[gpt-4]                                │
│ API Provider:   [OpenAI ▼]                          │
│ Base URL:       [https://api.openai.com]            │
│ API Key:        [•••••••••]                         │
│ 描述：           [用于生产环境的 GPT-4 代理]              │
│                                                       │
│ ▶ 高级配置：价格与使用限制                           │
│   ┌─────────────────────────────────────────────┐   │
│   │ Token 价格配置（用于费用计算）                 │   │
│   │ 输入价格：[$____] 每百万 token (美元)         │   │
│   │ 输出价格：[$____] 每百万 token (美元)         │   │
│   │ 缓存价格：[$____] 每百万 token (美元)         │   │
│   │                                               │   │
│   │ 使用限制                                      │   │
│   │ ┌─────────────────────────────────────────┐  │   │
│   │ │ 限制 1: [请求次数 ▼] [每日 ▼] 最大 [100] │  │   │
│   │ │          [× 删除]                        │  │   │
│   │ └─────────────────────────────────────────┘  │   │
│   │                                               │   │
│   │ [+ 添加限制]                                   │   │
│   └─────────────────────────────────────────────┘   │
│                                                       │
│          [保存修改]  [取消]                          │
└─────────────────────────────────────────────────────┘
```

### 2.2 高级配置区域

**默认状态**：折叠，显示 `▶ 高级配置：价格与使用限制`

**展开状态**：显示完整配置表单

### 2.3 价格配置字段

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `inputPricePer1M` | number | 条件必需 | 输入 token 每百万价格（美元），当有 cost 限制时必需 |
| `outputPricePer1M` | number | 条件必需 | 输出 token 每百万价格（美元），当有 cost 限制时必需 |
| `cachedPricePer1M` | number | 可选 | 缓存 token 每百万价格（美元） |

### 2.4 限制配置条目

每条限制包含：

| 字段 | 类型 | 必需 | 说明 | 选项 |
|------|------|------|------|------|
| `type` | string | ✅ | 限制类型 | `requests` / `input_tokens` / `cost` |
| `period` | string | ✅ | 时间周期 | `day` / `hours` / `week` / `month` |
| `periodValue` | number | 条件必需 | 当 `period=hours` 时指定小时数 | - |
| `max` | number | ✅ | 最大限制值 | - |

### 2.5 限制类型选项

| 值 | 显示名称 | 说明 |
|------|------|------|
| `requests` | 请求次数 | 限制 API 请求次数 |
| `input_tokens` | 输入 Token | 限制输入 token 数量 |
| `cost` | 费用 | 限制 API 费用消耗（美元） |

### 2.6 时间周期选项

| 值 | 显示名称 | 重置时机 |
|------|------|----------|
| `day` | 每日 | 每天 0 点重置 |
| `hours` | 最近 N 小时 | 滑动窗口，需填写小时数 |
| `week` | 每周 | 每周一 0 点重置 |
| `month` | 每月 | 每月 1 号 0 点重置 |

---

## 三、验证规则

### 3.1 前端验证

1. **必填字段验证**
   - `customModel`, `realModel`, `baseUrl`, `provider` 始终必填
   - `apiKey` 新增时必填，编辑时可选（留空保持原值）

2. **价格验证**
   - 当添加了 `cost` 类型的限制时，必须至少配置 `inputPricePer1M` 或 `outputPricePer1M` 之一
   - 验证失败时显示错误提示："费用限制需要配置 Token 价格（输入价格或输出价格）"

3. **限制配置验证**
   - 每条限制的 `max` 必须为正整数
   - 当 `period=hours` 时，`periodValue` 必须为正整数

### 3.2 后端验证

- 与前端验证规则一致，作为第二道防线
- 验证失败时返回 400 错误

---

## 四、技术实现

### 4.1 文件修改清单

| 文件 | 修改类型 | 说明 |
|------|----------|------|
| `src/admin/views/model-form.tsx` | 修改 | 添加价格字段和 limits 编辑器 |
| `src/admin/routes/model-form.tsx` | 修改 | 处理价格和 limits 数据保存 |
| `src/admin/views/models.tsx` | 修改 | 显示价格和限制概览（可选） |

### 4.2 组件结构

```
ModelFormPage
├── 基础字段表单（现有）
└── 高级配置区域（新增，可折叠）
    ├── 价格配置表单
    │   ├── inputPricePer1M
    │   ├── outputPricePer1M
    │   └── cachedPricePer1M
    └── 限制配置编辑器
        ├── 限制条目列表
        │   ├── type 下拉框
        │   ├── period 下拉框
        │   ├── periodValue 输入框（当 period=hours 时显示）
        │   ├── max 输入框
        │   └── 删除按钮
        └── 添加限制按钮
```

### 4.3 数据结构

表单提交数据格式：

```typescript
interface FormData {
  customModel: string;
  realModel: string;
  apiKey: string;
  baseUrl: string;
  provider: 'openai' | 'anthropic';
  desc?: string;
  
  // 新增字段
  inputPricePer1M?: string;    // 表单中为字符串，需转换为数字
  outputPricePer1M?: string;
  cachedPricePer1M?: string;
  
  // Limits 数据（动态字段）
  limitTypes?: string[];       // ['requests', 'input_tokens']
  limitPeriods?: string[];     // ['day', 'hours']
  limitPeriodValues?: string[]; // ['', '5'] 空字符串表示不填
  limitMaxValues?: string[];   // ['100', '50']
}
```

### 4.4 表单字段命名约定

为了支持动态添加/删除限制条目，使用数组形式的字段名：

- `limitTypes[]` - 限制类型数组
- `limitPeriods[]` - 限制周期数组
- `limitPeriodValues[]` - 周期值数组（hours 类型使用）
- `limitMaxValues[]` - 最大值数组

---

## 五、错误处理

### 5.1 错误提示

| 场景 | 错误信息 |
|------|----------|
| cost 限制但无价格配置 | "费用限制需要配置 Token 价格（输入价格或输出价格）" |
| 限制 max 值非正整数 | "限制最大值必须为正整数" |
| hours 周期但无 periodValue | "最近 N 小时需要填写小时数" |
| 保存失败 | "保存失败：{错误信息}" |

### 5.2 错误展示

- 表单顶部的红色警告框
- 保持用户已输入的数据

---

## 六、测试计划

### 6.1 手动测试场景

1. **新增模型 - 基础配置**
   - 不展开高级配置，仅填写基础字段
   - 验证可以正常保存

2. **新增模型 - 带价格配置**
   - 展开高级配置，填写价格字段
   - 不添加 limits，验证可以正常保存

3. **新增模型 - 带 limits 配置**
   - 添加 requests 类型限制
   - 添加 input_tokens 类型限制
   - 验证可以正常保存

4. **新增模型 - 带 cost 限制**
   - 添加 cost 类型限制
   - 不填写价格字段，验证前端阻止提交
   - 填写价格字段，验证可以正常保存

5. **编辑模型 - 修改 limits**
   - 展开高级配置
   - 添加/删除限制条目
   - 验证保存后配置正确

6. **编辑模型 - 修改价格**
   - 修改价格字段
   - 验证保存后配置正确

7. **hours 周期配置**
   - 选择"最近 N 小时"周期
   - 填写小时数
   - 验证可以正常保存

---

## 七、后续优化方向

1. **价格预设** - 提供常见模型的价格预设（如 GPT-4、Claude 等）
2. **限制模板** - 提供常用限制组合的快速选择
3. **用量预览** - 在表单中显示当前周期已用量的预览
4. **批量编辑** - 支持批量修改多个模型的限制配置

---

## 八、实现任务分解

1. **更新 model-form.tsx 视图**
   - 添加可折叠的高级配置区域
   - 添加价格配置字段
   - 添加 limits 动态编辑器
   - 添加前端验证逻辑

2. **更新 model-form.tsx 路由**
   - 解析价格和 limits 表单数据
   - 添加后端验证逻辑
   - 保存到配置文件

3. **更新 models.tsx 视图（可选）**
   - 在表格中显示价格信息
   - 在表格中显示限制概览

4. **编译测试**
   - 确保 TypeScript 编译通过
   - 手动测试各场景

---

## 九、配置示例

### 9.1 保存后的配置格式

```json
{
  "models": [
    {
      "customModel": "gpt-4-turbo",
      "realModel": "gpt-4-turbo-2024-04-09",
      "apiKey": "sk-xxx",
      "baseUrl": "https://api.openai.com",
      "provider": "openai",
      "desc": "生产环境 GPT-4",
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
