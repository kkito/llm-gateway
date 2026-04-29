# Model Groups 过滤隐藏模型 - 设计文档

## 背景

当前 Model Groups 的新增/编辑流程中，可选模型列表展示的是 `proxyConfig.models` 全部模型，未过滤 `hidden: true` 的隐藏模型。这导致管理员在创建或编辑模型组时，可以看到并选择本应隐藏的模型，不符合预期行为。

## 目标

在 Model Groups 的新增/编辑流程中，过滤掉 `hidden: true` 的模型，仅保留可见（`hidden` 不存在或 `hidden: false`）的模型作为可选列表。

## 过滤规则

- `hidden` 字段不存在 或 `hidden: false` → **显示**（保留）
- `hidden: true` → **隐藏**（过滤掉）

## 过滤范围

仅过滤**新增/编辑模型组时的可选模型列表**：
- ✅ 新增表单（`/admin/model-groups/new`）的可用模型列表
- ✅ 编辑表单（`/admin/model-groups/edit/:name`）的可用模型列表
- ❌ 模型组列表页（`/admin/model-groups`）中已关联的模型名称展示（即使模型已隐藏仍显示）

## 实现方案：路由层过滤（方案1）

### 修改文件
- `src/admin/routes/model-group-form.tsx`

### 实现细节

在路由文件中定义辅助函数 `getVisibleModels`，统一过滤逻辑：

```typescript
function getVisibleModels(config: ProxyConfig): ProviderConfig[] {
  return config.models.filter(m => m.hidden !== true);
}
```

然后在所有将 `proxyConfig.models` 传给 `ModelGroupFormPage` 的地方，替换为 `getVisibleModels(proxyConfig)`。

涉及以下路由处理函数的修改：
1. `GET /admin/model-groups/new` — 新增表单
2. `POST /admin/model-groups` — 新增保存（含错误回显）
3. `GET /admin/model-groups/edit/:name` — 编辑表单
4. `POST /admin/model-groups/edit/:name` — 编辑保存（含错误回显）

### 不修改的文件
- `src/admin/views/model-group-form.tsx` — 视图层无需变动，继续使用传入的 `models` prop
- `src/admin/routes/model-groups.tsx` — 模型组列表页不修改
- `src/config.ts` — 不新增全局工具函数，保持改动范围最小

## 测试策略

在 `tests/admin/routes/model-group-form.test.tsx` 中添加测试用例：

1. **正常场景**：配置中部分模型 `hidden: true`，访问新增/编辑表单时，可选列表不包含隐藏模型
2. **边界场景**：所有模型均 `hidden: true`，可选列表为空
3. **边界场景**：所有模型均不设置 `hidden` 字段，可选列表包含所有模型
4. **错误回显场景**：表单验证失败时，回显的模型列表同样经过过滤

## 验证方式

1. 启动服务，访问 `/admin/model-groups/new`，确认可选模型列表不包含 `hidden: true` 的模型
2. 编辑已有模型组，确认可用模型列表已过滤
3. 运行 `pnpm test` 确认所有测试通过
4. 运行 `pnpm build` 确认编译无错误
