# 模型价格配置功能设计

## 概述
在后台模型配置页面添加价格配置功能，支持设置每百万 token 的输入、输出、缓存价格，并保存到配置文件中。

## 需求
- 在模型表单中添加价格配置区域
- 支持设置输入 token 价格、输出 token 价格、缓存 token 价格
- 价格单位为人民币（元）
- 允许为空（不设置价格）
- 如果填写了，必须是非负数（>= 0）
- 支持小数

## 设计方案

### 1. 新增组件
创建独立的价格配置组件 `src/admin/components/PricingConfig.tsx`

### 2. 组件功能
- 标题：价格配置
- 说明文字：配置模型的 token 计费价格，用于费用统计
- 3 个输入框：
  - 输入 Token 价格（每百万，元）
  - 输出 Token 价格（每百万，元）
  - 缓存 Token 价格（每百万，元）
- 样式与现有表单保持一致

### 3. 修改的文件

| 文件 | 修改内容 |
|------|----------|
| `src/admin/components/PricingConfig.tsx` | 新增组件 |
| `src/admin/views/model-form.tsx` | 引入并使用新组件 |
| `src/admin/routes/model-form.tsx` | 处理表单提交时的价格字段 |

### 4. 数据存储
- 直接存储在 `ProviderConfig` 的 `inputPricePer1M`、`outputPricePer1M`、`cachedPricePer1M` 字段中
- 这些字段已存在于 `config.ts` 中，无需新增类型定义

### 5. 验证规则
- 前端验证：输入框类型为 number，min="0"，step="any"
- 后端验证：如果字段存在，必须是非负数
