# API Key 管理功能设计

## 概述

在后台管理中添加独立的 API Key 管理功能，允许用户集中存储和管理常用的 API Key，在配置模型时可选择已有 Key 或手动输入新 Key。

## 需求

1. **独立 API Key 存储**：API Key 单独存储，与模型配置分离，Key 可以被多个模型复用
2. **支持命名**：每个 API Key 都可以自定义名称（如「我的 OpenAI Key」），方便识别
3. **模型配置时选择**：在添加/编辑模型时，可以选择已有 API Key 或手动输入新 Key

## 数据结构

### API Key 存储

```typescript
interface ApiKey {
  id: string;          // 唯一标识，UUID
  name: string;        // 自定义名称，如 "我的 OpenAI Key"
  key: string;         // API Key 本身
  provider: 'openai' | 'anthropic';  // 所属 Provider
  createdAt: number;   // 创建时间戳
  updatedAt: number;   // 更新时间戳
}

interface ProxyConfig {
  models: ProviderConfig[];
  adminPassword?: string;
  apiKeys: ApiKey[];   // 新增：API Key 列表
}
```

## 功能设计

### 1. API Key 管理页面

- **列表页面** (`/admin/api-keys`)
  - 显示所有已存储的 API Key
  - 每行显示：名称、Provider 类型、创建时间
  - 支持新增、编辑、删除操作
  - 删除时显示确认对话框

- **新增/编辑弹窗或页面**
  - 名称（必填）：自定义标识
  - Provider（必填）：下拉选择 OpenAI / Anthropic
  - API Key（必填）：输入密钥，支持显示/隐藏切换

### 2. 模型表单改造

在现有的模型表单 (`/admin/models/new` 和 `/admin/models/edit/:customModel`) 中：

- 将 API Key 输入改为下拉选择 + 手动输入的组合
- 下拉选项包括：「手动输入...」（默认）+ 已有的 API Key
- 选择已有 Key 时自动填充，切换回「手动输入...」则清空

```jsx
// UI 结构示意
<label>
  API Key
  <select name="apiKeySource">
    <option value="manual">手动输入...</option>
    <option value="uuid-1">我的 OpenAI Key</option>
    <option value="uuid-2">Claude API</option>
  </select>
  <input
    name="apiKey"
    type="password"
    placeholder={isEdit ? '留空则保持原密钥不变' : '请输入 API Key'}
  />
  {/* 选择已有 Key 时此输入框禁用 */}
</label>
```

### 3. 后端 API

| 路由 | 方法 | 功能 |
|------|------|------|
| `/admin/api-keys` | GET | 获取所有 API Key（不返回 key 本身） |
| `/admin/api-keys` | POST | 新增 API Key |
| `/admin/api-keys/:id` | GET | 获取单个 API Key（返回 key） |
| `/admin/api-keys/:id` | PUT | 更新 API Key |
| `/admin/api-keys/:id` | DELETE | 删除 API Key |
| `/admin/api-keys/select-options` | GET | 获取用于下拉选择的选项列表（返回 id、name、key） |

## 配置存储

API Key 存储在 `config.json` 中，与 models 数组同级：

```json
{
  "models": [...],
  "adminPassword": "sha256hash...",
  "apiKeys": [
    {
      "id": "uuid-xxx",
      "name": "我的 OpenAI Key",
      "key": "sk-xxx",
      "provider": "openai",
      "createdAt": 1700000000000,
      "updatedAt": 1700000000000
    }
  ]
}
```

## 测试计划

### 单元测试 (config.ts)

1. `loadFullConfig` 能正确加载 apiKeys
2. `saveConfig` 能正确保存 apiKeys
3. API Key 的 CRUD 操作（addApiKey, updateApiKey, deleteApiKey, getApiKeys）

### 集成测试 (路由)

1. GET `/admin/api-keys` 返回正确的 Key 列表
2. POST 创建新 Key
3. PUT 更新 Key
4. DELETE 删除 Key
5. 模型表单获取 API Key 下拉选项
6. 选择已有 Key 后自动填充到表单
7. 权限检查：需要登录才能访问

## 影响范围

- **新增文件**：
  - `src/admin/views/api-keys.tsx` - API Key 管理页面
  - `src/admin/routes/api-keys.tsx` - API Key 路由
  - `tests/api-keys.test.ts` - API Key 测试

- **修改文件**：
  - `src/config.ts` - 添加 apiKeys 相关函数和类型
  - `src/admin/views/model-form.tsx` - 添加 API Key 选择功能
  - `src/admin/components/Layout.tsx` - 添加导航入口
  - `src/server.ts` - 注册新路由
  - `tests/config.test.ts` - 添加 apiKeys 相关测试

## 优先级

1. config.ts 中的数据结构和基础函数
2. API Key 管理页面和路由
3. 模型表单改造
4. 单元测试和集成测试