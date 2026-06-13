# 用户模型访问权限控制 — 设计文档

## 1. 功能概述

为 LLM Gateway 的用户系统增加模型级访问控制，支持管理员在后台为每个用户指定可使用的模型列表。

### 1.1 核心特性

- 🎯 **模型级权限**：创建/编辑用户时可选择允许的模型
- 🔓 **无限制模式**：不选任何模型时，用户可以使用所有模型（向后兼容）
- ⛔ **403 拒绝**：调用无权限模型时返回 403 Forbidden
- 📋 **列表过滤**：模型列表页面/API 只展示用户有权限的模型
- 🔧 **拦截器实现**：复用现有 UpstreamInterceptor 框架
- ✅ **全面测试**：单元测试 + TSX 视图测试 + E2E 测试

### 1.2 约束范围

| 场景 | 是否限制 |
|------|---------|
| 单个模型请求 (`model` 字段) | ✅ 是 |
| 模型组请求 (`model_group` 字段) | ❌ 否，保持现有行为 |
| 模型列表展示 (`/user/main`) | ✅ 是 |
| 未登录/认证未启用 | ❌ 不限制，所有模型可用 |

---

## 2. 数据模型变更

### 2.1 UserApiKey 接口

```typescript
// src/config.ts
export interface UserApiKey {
  name: string;
  apikey: string;
  desc?: string;
  /** 允许使用的模型列表（customModel 名称）。空或 undefined 表示不限制 */
  allowedModels?: string[];
}
```

### 2.2 配置文件示例

```json
{
  "models": [
    { "customModel": "gpt-4", "realModel": "gpt-4", ... },
    { "customModel": "claude-3", "realModel": "claude-3-opus", ... },
    { "customModel": "gemini-pro", "realModel": "gemini-1.5-pro", ... }
  ],
  "userApiKeys": [
    {
      "name": "Alice",
      "apikey": "sk-lg-abc123",
      "allowedModels": ["gpt-4", "claude-3"]
    },
    {
      "name": "Bob",
      "apikey": "sk-lg-def456"
    }
  ]
}
```

- Alice 只能使用 `gpt-4` 和 `claude-3`
- Bob 没有 `allowedModels`，可以使用所有模型

---

## 3. 管理后台 UI

### 3.1 用户表单变更

在现有创建/编辑用户表单（`src/admin/views/user-form.tsx`）基础上增加模型选择区：

- 从 `config.models` 获取所有模型列表
- 每个模型用复选框展示（`customModel` 名称 + `realModel` 说明）
- 新增/编辑时均可选择
- 不选 = 无限制
- 编辑时已选模型回显勾选

### 3.2 Props 变更

```typescript
interface Props {
  mode: 'new' | 'edit';
  user?: UserApiKey;
  models?: Array<{ customModel: string; realModel: string; desc?: string }>;
}
```

### 3.3 后端路由变更

- `GET /admin/users/new` — 加载模型列表传给页面
- `GET /admin/users/edit/:name` — 加载模型列表 + 用户已选模型
- `POST /admin/users/new` — 接收 `allowedModels` 数组
- `POST /admin/users/edit/:name` — 接收 `allowedModels` 数组

---

## 4. 权限拦截器

### 4.1 新拦截器文件

`src/interceptor/user-model-access.ts`

```typescript
import type { UpstreamInterceptor } from './types.js'

export class PermissionError extends Error {
  constructor(model: string) {
    super(`You don't have access to model: ${model}`)
    this.name = 'PermissionError'
  }
}

export const userModelAccessInterceptor: UpstreamInterceptor = async (upstream, ctx) => {
  const { currentUser, customModel } = ctx
  if (!currentUser) return upstream

  const allowed = (currentUser as any).allowedModels
  if (!allowed || allowed.length === 0) return upstream

  if (!allowed.includes(customModel)) {
    throw new PermissionError(customModel)
  }

  return upstream
}
```

### 4.2 注册到 server.ts

```typescript
// src/server.ts
import { userModelAccessInterceptor } from './interceptor/user-model-access.js'
interceptors.use(userModelAccessInterceptor)
```

### 4.3 Handler 异常处理

在 `src/routes/chat-completions/handler.ts` 的 catch 块中新增 PermissionError 处理：

```typescript
if (error.name === 'PermissionError') {
  return c.json({
    error: { message: error.message, type: 'permission_error' }
  }, 403)
}
```

### 4.4 Messages 端点同样处理

`src/routes/messages/handler.ts` 的 catch 块同样新增 PermissionError → 403 处理。
注意：messages handler 已经使用了 `interceptors.execute()`，拦截器会自动执行。

---

## 5. 模型列表过滤

### 5.1 用户主页（/user/main）

`src/user/routes/home.tsx` → `/user/main` — 传给 `HomePage` 组件的模型列表根据当前用户过滤：

```typescript
let visibleModels = currentConfig.models
if (currentUser?.allowedModels?.length) {
  visibleModels = currentConfig.models.filter(
    m => currentUser.allowedModels!.includes(m.customModel)
  )
}
return c.html(<HomePage models={visibleModels} ... />)
```

注意：未启用认证时 `currentUser` 为 undefined，全部展示。当前代码已经通过 `getCurrentUser(c, configPath)` 获取用户信息。

---

## 6. 测试计划

### 6.1 单元测试

| 文件 | 测试内容 |
|------|---------|
| `tests/interceptor/user-model-access.test.ts` | 拦截器各种 case：无限制/有权限/无权限/未登录 |
| | PermissionError 类的正确性 |

### 6.2 视图测试

| 文件 | 测试内容 |
|------|---------|
| `tests/admin/views/user-form.test.tsx` | 传入 models props 是否渲染复选框 |
| | 编辑模式回显已选模型 |
| | 无模型时只显示名称/描述输入框 |

### 6.3 E2E 测试

| 测试场景 | 验证点 |
|---------|--------|
| 创建用户时选择模型 → 用该用户 API Key 调用有权限模型 | 200 OK |
| 创建用户时选择模型 → 用该用户 API Key 调用无权限模型 | 403 Forbidden |
| 创建用户时不选模型 → 调用任意模型 | 200 OK |
| 编辑用户修改模型权限 | 权限即时生效 |
| 未启用用户认证时 → 不受影响 | 所有模型可调用 |

---

## 7. 文件变更清单

| 文件 | 变更类型 |
|------|---------|
| `src/config.ts` | 修改 — UserApiKey 增加 allowedModels |
| `src/admin/views/user-form.tsx` | 修改 — 增加模型复选框 |
| `src/admin/routes/users.tsx` | 修改 — 加载/传递模型列表，接收 allowedModels |
| `src/interceptor/user-model-access.ts` | 新增 — 权限拦截器 |
| `src/server.ts` | 修改 — 注册拦截器 |
| `src/routes/chat-completions/handler.ts` | 修改 — PermissionError 处理 |
| `src/routes/messages/handler.ts` | 修改 — PermissionError 处理 |
| `src/user/routes/home.tsx` | 修改 — 模型列表过滤 |
| `src/user/middleware/auth.ts` | 无需修改 — `getCurrentUser` 已返回完整 UserApiKey 对象 |
| `tests/interceptor/user-model-access.test.ts` | 新增 |
| `tests/admin/views/user-form.test.tsx` | 新增 |
| `tests/e2e/user-model-access.e2e.test.ts` | 新增 |
