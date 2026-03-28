# Admin 密码认证功能

LLM Gateway 的管理后台支持密码认证功能，保护管理界面不被未授权访问。

## 功能概述

- 🔐 **首次访问自动设置密码**：首次访问管理后台时会自动提示设置密码
- 🔑 **SHA256 加密存储**：密码使用 SHA256 + 固定盐值进行哈希加密
- 🍪 **Session 认证**：登录后保持会话状态，支持 Cookie、Header、Query 三种方式
- 🔄 **密码管理**：支持修改密码和删除密码保护
- 🛡️ **路由保护**：所有 `/admin/*` 路由（除登录页外）都需要认证

## 快速开始

### 首次使用

1. 启动服务后访问管理后台：http://localhost:4000/admin/models
2. 系统检测到未设置密码，自动跳转到登录页
3. 输入密码并确认，完成首次设置
4. 设置完成后自动登录并跳转到管理后台

### 日常登录

1. 访问任意管理页面（如 http://localhost:4000/admin/models）
2. 输入密码登录
3. 登录成功后可访问所有管理功能

## 密码管理

### 修改密码

1. 访问密码管理页面：http://localhost:4000/admin/password
2. 选择"修改密码"操作
3. 输入当前密码（如果已有密码）
4. 输入新密码并确认
5. 保存后新密码立即生效

### 删除密码保护

> ⚠️ 删除密码后，任何人都可以访问管理后台，请谨慎操作

1. 访问密码管理页面：http://localhost:4000/admin/password
2. 选择"删除密码"操作
3. 输入当前密码验证
4. 确认后删除密码保护

## 技术实现

### 密码加密

```typescript
// 使用 SHA256 + 固定盐值 "llm-gateway"
export function hashPassword(password: string): string {
  return createHash('sha256')
    .update('llm-gateway' + password)
    .digest('hex');
}
```

**加密特点：**
- 算法：SHA256
- 盐值：`llm-gateway`（固定前缀）
- 输出：64 字符十六进制字符串

### Session 管理

Session 采用内存存储方式，服务重启后所有 Session 失效。

**Session 传递方式：**

| 方式 | 示例 | 说明 |
|------|------|------|
| Cookie | `session=abc123...` | 浏览器自动携带 |
| Authorization Header | `Bearer abc123...` | API 调用使用 |
| Query 参数 | `?session=abc123...` | 临时访问使用 |

**Session 生命周期：**
- 登录时生成：`随机字符串 (32 位) + 时间戳`
- 存储在内存 `Set<string>` 中
- 登出或服务重启时清除

### 认证流程

```
访问 /admin/*
    ↓
检查路径是否为 /login 或 /password
    ↓
是 → 允许访问
否 → 检查是否配置密码
    ↓
未配置 → 允许访问（首次设置）
已配置 → 验证 Session
    ↓
有效 → 允许访问
无效 → 重定向到 /admin/login
```

### 配置文件

密码存储在配置文件中：`~/.llm-gateway/config.json`

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
  "adminPassword": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
}
```

**配置说明：**
- `adminPassword` 字段存储密码的 SHA256 哈希值
- 删除该字段即删除密码保护
- 配置文件支持热加载，修改后立即生效

## 管理后台路由

| 路由 | 方法 | 认证 | 功能 |
|------|------|------|------|
| `/admin/login` | GET/POST | ❌ | 登录页面 |
| `/admin/password` | GET/POST | ❌ | 密码管理页面 |
| `/admin/models` | GET | ✅ | 模型列表 |
| `/admin/models/new` | GET/POST | ✅ | 新增模型 |
| `/admin/models/edit/:model` | GET/POST | ✅ | 编辑模型 |
| `/admin/models/delete/:model` | POST | ✅ | 删除模型 |
| `/admin/models/move/:model` | POST | ✅ | 调整顺序 |
| `/admin/stats` | GET | ✅ | 统计 Dashboard |
| `/admin/api/stats` | GET | ✅ | 统计 API 接口 |

## 安全建议

1. **使用强密码**：建议密码长度至少 8 位，包含大小写字母、数字和特殊字符
2. **生产环境部署**：建议配合反向代理（如 Nginx）使用 HTTPS 加密传输
3. **定期修改密码**：定期更新密码以提高安全性
4. **配置文件权限**：确保 `~/.llm-gateway/config.json` 文件权限设置为仅所有者可读写

```bash
# 设置配置文件权限（Linux/macOS）
chmod 600 ~/.llm-gateway/config.json
```

## 常见问题

### Q: 忘记密码怎么办？

A: 手动编辑配置文件 `~/.llm-gateway/config.json`，删除 `adminPassword` 字段，然后重启服务重新设置密码。

### Q: Session 有效期是多久？

A: 当前实现中 Session 没有过期时间，服务重启前一直有效。如需退出登录，可关闭浏览器清除 Cookie。

### Q: 支持多用户吗？

A: 当前版本仅支持单用户密码认证，不支持多用户管理。

### Q: 密码加密强度如何？

A: 使用 SHA256 哈希算法，配合固定盐值。对于一般使用场景足够安全，但不建议用于高安全需求场景。

## 用户管理

### 访问用户管理界面

访问 `http://localhost:4000/admin/users`（需要先通过 Admin 密码认证）。

### 新增用户

1. 点击"新增用户"按钮
2. 填写用户名称（必填）和描述（可选）
3. 系统自动生成 API Key
4. 将 API Key 提供给用户

### 删除用户

1. 在用户列表中找到目标用户
2. 点击"删除"按钮
3. 确认后用户立即失效

### 启用/禁用用户认证

- 配置 `userApiKeys` 后自动启用认证
- 清空 `userApiKeys` 数组可禁用认证

### 配置文件示例

```json
{
  "models": [...],
  "adminPassword": "...",
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

### 配置字段说明

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `name` | string | ✅ | 用户名称（用于显示） |
| `apikey` | string | ✅ | API Key（格式：`sk-lg-xxxxxxxxxxxxxxx`） |
| `desc` | string | ❌ | 描述信息（可选） |

## 相关文件

- 认证中间件：`src/admin/middleware/auth.ts`
- 登录路由：`src/admin/routes/login.tsx`
- 密码管理路由：`src/admin/routes/password.tsx`
- 配置管理：`src/config.ts`
