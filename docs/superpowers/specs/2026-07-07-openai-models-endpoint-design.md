# OpenAI 兼容 /v1/models 接口设计

日期：2026-07-07

## 背景

llm-gateway 已支持 OpenAI 兼容的 `/v1/chat/completions`，但缺少对应的 `/v1/models`
模型列表接口。现有 `server.ts` 引用了 `createModelsRoute`（来自 `./admin/routes/models.js`），
而源码中该 API 文件并不存在（只有 `models.tsx` 管理页面），导致 `/models` 实际是挂在
`/admin/models` 的 HTML 页面路由，并非 OpenAI 兼容的 JSON 接口。

本设计新增一个返回标准 OpenAI `list` 结构的 `/v1/models`（及别名 `/models`）JSON 接口，
并把原有 HTML 页面收敛到 `/admin/models`。

## 目标

- 暴露 `/v1/models` 与 `/models`，均返回 OpenAI 兼容的模型列表 JSON。
- 模型配置新增 `max_context_length` 字段（默认 200000）。
- 模型组（ModelGroup）也作为一条 `data` 项返回。
- 原有管理页面仅能通过 `/admin/models` 访问。

## 非目标（YAGNI）

- 不实现模型创建/删除/更新的 `/v1/models` 写接口（只读）。
- 不引入分页游标（`has_more` 恒为 false）。
- 不为组增加独立配置字段。

## 数据结构

### 响应外壳

```json
{
  "object": "list",
  "data": [ /* Model 对象数组 */ ],
  "has_more": false
}
```

### Model 对象（模型条目）

| 字段 | 类型 | 取值 |
|------|------|------|
| `id` | string | `ProviderConfig.customModel` |
| `object` | string | 固定 `"model"` |
| `created` | number | 请求时的 Unix 时间戳（秒） |
| `max_context_length` | number | `ProviderConfig.maxContextLength`，缺省 200000 |
| `status` | string | `hidden === true` → `"deprecated"`，否则 `"active"` |
| `owned_by` | string | 固定 `"llmgateway-model"` |

### Model 对象（模型组条目）

| 字段 | 类型 | 取值 |
|------|------|------|
| `id` | string | `ModelGroup.name` |
| `object` | string | 固定 `"model"` |
| `created` | number | 请求时的 Unix 时间戳（秒） |
| `max_context_length` | number | 组内第一个模型（按 `customModel` 在 `models` 中查找）的 `maxContextLength` |
| `status` | string | 固定 `"active"` |
| `owned_by` | string | 固定 `"llmgateway-group"` |

`data` 顺序：先所有模型条目，再所有模型组条目。

## 数据模型变更（src/config.ts）

`ProviderConfig` 新增可选字段：

```ts
maxContextLength?: number; // 最大上下文窗口，未配置时默认 200000
```

在 `loadConfig` / `loadFullConfig` 读入 `models` 后，统一填充默认值：

```ts
models.forEach(m => { if (m.maxContextLength == null) m.maxContextLength = 200000; });
```

- 字段可选，老配置无需改动即向后兼容。
- `ModelGroup` 接口不加字段。

## 路由实现（方案 A）

### 新建 src/routes/models.ts

```ts
export function createModelsRoute(config: ProxyConfig | (() => ProxyConfig)) {
  const router = new Hono();
  const handler = (c) => {
    const currentConfig = typeof config === 'function' ? config() : config;
    return c.json(buildModelsList(currentConfig));
  };
  router.get('/models', handler);
  router.get('/v1/models', handler);
  return router;
}
```

`buildModelsList(config)` 产出上文「响应外壳 + data」结构。

### server.ts 调整

- import 由 `./admin/routes/models.js` 改为 `./routes/models.js`。
- 原有的 `models.tsx` 页面组件保留，另建 `createModelsPageRoute`（放在 `src/admin/routes/`）
  明确挂到 `/admin/models`，不再占用 `/models`。
- `/models` 路径**跳过** user 认证（公开访问）；`/v1/models` 沿用现有 `/v1/*` user 认证中间件。

## 认证

- `/v1/models`：受 `app.use('/v1/*', createUserAuthMiddleware)` 覆盖（与 `/v1/chat/completions` 一致）。
- `/models`：不在认证中间件列表中注册，公开可访问。

## 测试

- 单测 `buildModelsList`：验证字段映射、`hidden→deprecated`、`maxContextLength` 默认值、
  模型组 `owned_by` 与取第一个模型上下文长度、组 `status` 恒为 active。
- 集成测试（Hono `app.request`）：`GET /v1/models` 返回 200 + 正确结构；`GET /models` 返回相同结构。

## 风险 / 注意

- `server.ts` 原 import 的 `./admin/routes/models.js` 文件不存在，改为 `./routes/models.js` 后
  该路径必须有实体文件，否则启动报错。
- 老配置无 `maxContextLength` 时由 `loadConfig` 补全，运行时 `currentConfig` 已含默认值，接口直接读取即可。
