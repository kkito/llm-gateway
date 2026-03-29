# 用户 API Key 认证功能设计方案

## 1. 功能概述

LLM Gateway 新增用户级 API Key 认证功能，支持多用户管理和独立的统计 Dashboard。

### 1.1 核心特性

- 🔑 **多用户支持**：支持配置多个用户 API Key
- 🎯 **可选启用**：未配置时保持开放访问（与 Admin 密码逻辑一致）
- 🔐 **双重认证体系**：Admin 密码和用户 API Key 完全独立
- 📊 **独立统计**：每个用户只能查看自己的使用统计
- 🔄 **配置热加载**：支持配置文件热更新
- 🛡️ **全栈认证**：API 调用和 Web 界面都需要认证

### 1.2 设计原则

1. **简单性**：配置结构简单，易于理解和维护
2. **隔离性**：Admin 和用户系统完全分离
3. **向后兼容**：未启用时行为与现有系统一致
4. **安全性**：API Key 随机生成，避免弱密钥

---

## 2. 配置结构

### 2.1 配置文件格式

```json
{
  "models": [
    {
      "customModel": "my-gpt4",
      "realModel": "gpt-4",
      "apiKey": "sk-xxx",
      "baseUrl": "https://api.openai.com",
      "provider": "openai"
    }
  ],
  "adminPassword": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "userApiKeys": [
    {
      "name": "用户 A",
      "apikey": "sk-lg-abc123def456",
      "desc": "开发测试用"
    },
    {
      "name": "用户 B",
      "apikey": "sk-lg-xyz789uvw012",
      "desc": "生产环境用"
    }
  ]
}
```

### 2.2 配置字段说明

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `name` | string | ✅ | 用户名称（用于显示） |
| `apikey` | string | ✅ | API Key（格式：`sk-lg-xxxxxxxxxxxxxxx`） |
| `desc` | string | ❌ | 描述信息（可选） |

### 2.3 启用逻辑

```typescript
// 启用用户认证的判断
const isUserAuthEnabled = config.userApiKeys && config.userApiKeys.length > 0;
```

- 未配置 `userApiKeys` 字段 → 无需认证
- 配置为空数组 `[]` → 无需认证
- 配置包含至少一个用户 → 启用认证

---

## 3. 系统架构

### 3.1 认证流程图

```
请求到达
    ↓
判断路径类型
    ↓
┌─────────────────┬─────────────────┬─────────────────┐
│   /admin/*      │    /user/*      │   /v1/* (API)   │
└─────────────────┴─────────────────┴─────────────────┘
    ↓                    ↓                    ↓
Admin 认证检查      User 认证检查       User 认证检查
    ↓                    ↓                    ↓
检查 adminPassword   检查 userApiKeys    检查 userApiKeys
    ↓                    ↓                    ↓
已设置 → 验证 Session  已启用 → 验证 API Key  已启用 → 验证 API Key
未设置 → 允许访问     未启用 → 允许访问     未启用 → 允许访问
```

### 3.2 认证中间件层次

```
app
├── 全局中间件（日志、配置注入）
├── /admin/* 路由
│   └── adminAuthMiddleware（检查 adminPassword + Session）
├── /user/* 路由
│   └── userAuthMiddleware（检查 userApiKeys + API Key）
└── /v1/* 路由
    └── userAuthMiddleware（检查 userApiKeys + API Key）
```

---

## 4. 技术实现

### 4.1 API Key 生成

```typescript
/**
 * 生成用户 API Key
 * 格式：sk-lg-xxxxxxxxxxxxxxx（sk-lg- + 20 位随机字符）
 */
export function generateUserApiKey(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let randomPart = '';
  const randomBytes = new Uint8Array(20);
  crypto.getRandomValues(randomBytes);
  for (let i = 0; i < 20; i++) {
    randomPart += chars[randomBytes[i] % chars.length];
  }
  return `sk-lg-${randomPart}`;
}
```

### 4.2 用户接口类型

```typescript
export interface UserApiKey {
  name: string;
  apikey: string;
  desc?: string;
}

export interface ProxyConfig {
  models: ProviderConfig[];
  adminPassword?: string;
  userApiKeys?: UserApiKey[];
}
```

### 4.3 认证中间件

#### 4.3.1 User Auth Middleware

```typescript
// src/user/middleware/auth.ts

export async function userAuthMiddleware(c: Context, next: Next) {
  const config = loadFullConfig(configPath);
  const isAuthEnabled = config.userApiKeys && config.userApiKeys.length > 0;

  // 未启用认证，直接放行
  if (!isAuthEnabled) {
    await next();
    return;
  }

  // 提取 API Key（支持两种方式）
  const apiKey = 
    c.req.header('Authorization')?.replace('Bearer ', '') ||
    c.req.header('x-api-key');

  if (!apiKey) {
    return c.json({ error: { message: 'Missing API Key' } }, 401);
  }

  // 验证 API Key 是否存在
  const validUser = config.userApiKeys?.find(u => u.apikey === apiKey);
  if (!validUser) {
    return c.json({ error: { message: 'Invalid API Key' } }, 401);
  }

  // 将用户信息注入上下文
  (c as any).currentUser = validUser;
  await next();
}
```

> **注意**：HTTP Header 名称不区分大小写（RFC 7230）。Hono 框架自动处理大小写，用户传递 `x-api-key`、`X-Api-Key`、`X-API-KEY` 均可正确识别。

#### 4.3.2 Session 管理（用户登录态）

```typescript
// src/user/middleware/auth.ts

// 用户 Session 存储（内存）
export const userSessions = new Map<string, UserApiKey>();

/**
 * 生成用户 Session ID
 */
function generateUserSessionId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

/**
 * 用户登录（通过 API Key）
 */
export function loginUserSession(apiKey: string): string | null {
  const config = loadFullConfig(configPath);
  const user = config.userApiKeys?.find(u => u.apikey === apiKey);
  if (!user) return null;

  const sessionId = generateUserSessionId();
  userSessions.set(sessionId, user);
  return sessionId;
}

/**
 * 获取当前登录用户
 */
export function getCurrentUser(c: Context): UserApiKey | null {
  // 1. 优先从 API Key 获取（API 调用）
  const apiKey = 
    c.req.header('Authorization')?.replace('Bearer ', '') ||
    c.req.header('x-api-key');
  
  if (apiKey) {
    const config = loadFullConfig(configPath);
    return config.userApiKeys?.find(u => u.apikey === apiKey) || null;
  }

  // 2. 从 Session 获取（Web 界面）
  const sessionId = 
    c.req.header('Cookie')?.match(/user_session=([^;]+)/)?.[1] ||
    c.req.query('session');
  
  if (sessionId && userSessions.has(sessionId)) {
    return userSessions.get(sessionId)!;
  }

  return null;
}
```

### 4.4 统计系统扩展

#### 4.4.1 日志格式扩展

在现有 `LogEntry` 中增加 `userName` 字段：

```typescript
export interface LogEntry {
  timestamp: string;
  requestId: string;
  customModel: string;
  realModel?: string;
  provider?: string;
  endpoint: string;
  method: string;
  statusCode: number;
  durationMs: number;
  isStreaming: boolean;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  userName?: string;  // 新增：用户名称
  error?: {
    message: string;
    type?: string;
  };
}
```

#### 4.4.2 统计核心扩展

```typescript
// src/lib/stats-core.ts

export interface UserStatsOptions extends StatsOptions {
  userName?: string;  // 筛选特定用户
}

export function loadStats(
  logDir: string, 
  options: UserStatsOptions = {}
): Stats {
  const logFiles = getLogFilesForRange(logDir, options);

  let entries: StatsEntry[] = [];
  for (const file of logFiles) {
    entries = entries.concat(parseLogFile(file));
  }

  // 如果指定了 userName，过滤日志
  if (options.userName) {
    entries = entries.filter(e => e.userName === options.userName);
  }

  return calculateStats(entries, options);
}
```

### 4.5 路由设计

#### 4.5.1 用户路由

| 路由 | 方法 | 认证 | 功能 |
|------|------|------|------|
| `/user/login` | GET/POST | ❌ | 用户登录页（输入 API Key） |
| `/user/main` | GET | ✅ | 用户首页/配置指南 |
| `/user/stats` | GET | ✅ | 用户统计 Dashboard |
| `/user/logout` | POST | ✅ | 用户登出 |

#### 4.5.2 Admin 用户管理路由

| 路由 | 方法 | 认证 | 功能 |
|------|------|------|------|
| `/admin/users` | GET | ✅ Admin | 用户列表 |
| `/admin/users/new` | GET/POST | ✅ Admin | 新增用户 |
| `/admin/users/edit/:name` | GET/POST | ✅ Admin | 编辑用户 |
| `/admin/users/delete/:name` | POST | ✅ Admin | 删除用户 |
| `/admin/users/toggle` | POST | ✅ Admin | 启用/禁用用户认证 |

---

## 5. 数据流

### 5.1 API 调用流程（以 OpenAI 格式为例）

```
POST /v1/chat/completions
    ↓
userAuthMiddleware
    ↓
提取 API Key（Authorization 或 x-api-key）
    ↓
验证 API Key 有效性
    ↓
注入 currentUser 到上下文
    ↓
路由处理（converters → providers）
    ↓
记录日志（包含 userName）
    ↓
返回响应
```

### 5.2 用户登录流程

```
访问 /user/login
    ↓
显示登录表单（输入 API Key）
    ↓
POST /user/login（提交 API Key）
    ↓
验证 API Key
    ↓
生成 Session ID
    ↓
设置 Cookie: user_session=<sessionId>
    ↓
重定向到 /user/main
```

### 5.3 用户统计流程

```
访问 /user/stats
    ↓
userAuthMiddleware（检查登录态）
    ↓
获取当前用户 userName
    ↓
loadStats(logDir, { userName: currentUserName })
    ↓
渲染统计页面（仅显示当前用户数据）
```

---

## 6. 文件结构

### 6.1 新增文件

```
src/
├── user/
│   ├── middleware/
│   │   └── auth.ts           # 用户认证中间件
│   ├── routes/
│   │   ├── login.tsx         # 用户登录路由
│   │   ├── main.tsx          # 用户首页路由（现有）
│   │   └── stats.tsx         # 用户统计路由
│   └── views/
│       ├── login.tsx         # 登录页面组件
│       ├── main.tsx          # 首页组件（现有）
│       └── stats.tsx         # 统计页面组件
├── admin/
│   └── routes/
│       └── users.tsx         # 用户管理路由
└── lib/
    └── apikey.ts             # API Key 生成工具
```

### 6.2 修改文件

```
src/
├── config.ts                 # 扩展 ProxyConfig 接口
├── server.ts                 # 注册新用户路由和中间件
├── logger.ts                 # LogEntry 增加 userName 字段
└── lib/
    └── stats-core.ts         # 支持按用户过滤统计
```

---

## 7. 错误处理

### 7.1 API Key 相关错误

| 场景 | HTTP 状态码 | 错误消息 |
|------|------------|----------|
| 缺少 API Key | 401 | `Missing API Key` |
| 无效的 API Key | 401 | `Invalid API Key` |
| 未授权访问用户页面 | 302 | 重定向到 `/user/login` |

### 7.2 Admin 管理错误

| 场景 | HTTP 状态码 | 错误消息 |
|------|------------|----------|
| 非 Admin 访问用户管理 | 302 | 重定向到 `/admin/login` |
| 用户已存在 | 400 | `用户已存在` |
| 用户不存在 | 404 | `用户不存在` |
| 名称为空 | 400 | `用户名称不能为空` |

---

## 8. 测试策略

### 8.1 单元测试

- `lib/apikey.test.ts`：API Key 生成格式验证
- `user/middleware/auth.test.ts`：用户认证中间件逻辑
- `admin/routes/users.test.ts`：用户管理路由逻辑

### 8.2 E2E 测试

- `tests/e2e/user-auth.e2e.test.ts`：用户认证全流程
  - 未启用认证时的开放访问
  - 启用认证后的访问控制
  - API Key 登录流程
  - 用户统计页面访问
  - API 调用认证

- `tests/e2e/admin-users.e2e.test.ts`：Admin 用户管理
  - 新增用户
  - 编辑用户
  - 删除用户
  - 启用/禁用用户认证

### 8.3 集成测试

- 用户认证与统计系统的集成
- 日志记录与用户过滤的集成

---

## 9. 文档计划

### 9.1 用户文档

创建 `docs/user-api-key.md`，包含：
- 功能概述
- 快速开始（如何获取 API Key）
- 使用指南（如何在 API 调用中使用）
- 统计 Dashboard 说明
- 常见问题

### 9.2 Admin 文档

在 `docs/admin-password.md` 基础上补充：
- 用户管理界面使用说明
- 用户 API Key 管理操作指南

---

## 10. 实施计划

### Phase 1: 核心基础设施
1. 扩展配置接口（`config.ts`）
2. 实现 API Key 生成工具（`lib/apikey.ts`）
3. 实现用户认证中间件（`user/middleware/auth.ts`）
4. 扩展日志格式（`logger.ts`）

### Phase 2: 用户界面
1. 用户登录页面（`user/routes/login.tsx`, `user/views/login.tsx`）
2. 用户统计页面（`user/routes/stats.tsx`, `user/views/stats.tsx`）
3. 修改现有首页路由（`user/routes/main.tsx`）

### Phase 3: Admin 管理界面
1. 用户列表页面（`admin/routes/users.tsx`）
2. 用户表单页面（新增/编辑）
3. 用户管理 API

### Phase 4: 统计系统扩展
1. 扩展 `stats-core.ts` 支持用户过滤
2. 修改日志记录逻辑（注入 `userName`）

### Phase 5: 测试与文档
1. 编写单元测试
2. 编写 E2E 测试
3. 编写用户文档和管理员文档

---

## 11. 安全考虑

### 11.1 API Key 安全

1. **生成强度**：使用 `crypto.getRandomValues()` 生成随机数
2. **格式规范**：固定前缀 `sk-lg-` 便于识别和管理
3. **存储方式**：明文存储于配置文件（建议配置文件权限设置为 600）

### 11.2 访问控制

1. **Admin 与用户隔离**：Admin 密码和用户 API Key 完全独立
2. **最小权限原则**：用户只能访问自己的统计数据
3. **认证优先级**：API Key 认证优先于 Session 认证

### 11.3 建议

1. **配置文件权限**：
   ```bash
   chmod 600 ~/.llm-gateway/config.json
   ```

2. **生产环境**：建议配合 HTTPS 使用

---

## 12. 向后兼容性

### 12.1 配置兼容

- 旧配置（无 `userApiKeys` 字段）→ 自动视为未启用认证
- 空数组配置 → 视为未启用认证

### 12.2 行为兼容

- 未启用认证时，所有行为与现有系统完全一致
- 现有 API 调用无需修改

---

## 13. 性能考虑

### 13.1 认证开销

- API Key 验证：O(n) 线性查找（n 为用户数量，通常 < 100）
- Session 验证：O(1) Map 查找

### 13.2 统计查询

- 用户统计通过过滤日志实现，不增加额外存储
- 大日志文件可能影响查询性能（未来可考虑数据库存储）

---

## 14. 未来扩展

### 14.1 可能的增强功能

1. **用户配额管理**：限制每个用户的 Token 使用量
2. **用户模型权限**：控制用户可访问的模型列表
3. **API Key 轮换**：支持生成新 Key 并自动失效旧 Key
4. **审计日志**：记录用户登录和管理操作

### 14.2 暂不实现

1. 多用户同时登录管理
2. API Key 过期时间设置
3. 用户分组/角色管理

---

## 15. 验收标准

### 15.1 功能验收

- [ ] 未配置 `userApiKeys` 时，系统行为与现有版本一致
- [ ] 配置 `userApiKeys` 后，API 调用必须提供有效 API Key
- [ ] 配置 `userApiKeys` 后，用户界面必须登录才能访问
- [ ] 用户只能查看自己的统计数据
- [ ] Admin 可以完整管理用户（增删改查）
- [ ] 支持通过 `Authorization` Header 和 `x-api-key` Header 传递 API Key
- [ ] API Key 格式为 `sk-lg-xxxxxxxxxxxxxxx`

### 15.2 测试验收

- [ ] 单元测试覆盖率 > 80%
- [ ] E2E 测试覆盖所有核心流程
- [ ] 所有测试通过

### 15.3 文档验收

- [ ] 用户文档 `docs/user-api-key.md` 完成
- [ ] 管理员文档更新完成
- [ ] README 更新（如需要）
