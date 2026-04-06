[English](./README.md) | [中文](./README_zh.md)

# LLM Gateway

LLM Proxy Gateway - 统一管理多个大模型 API 的代理服务器

## 使用场景

- [个人开发者统一管理 API](docs/scenarios/personal-api-management.md)
- [团队共享 LLM 资源](docs/scenarios/team-resource-sharing.md)
- [API 用量统计与计费](docs/scenarios/usage-statistics-billing.md)
- [多模型切换测试](docs/scenarios/multi-model-switching.md)
- [替代复杂开源方案](docs/scenarios/lightweight-alternative.md)
- [国产模型格式兼容](docs/scenarios/domestic-model-compat.md)
- [多平台轮询规避限制](docs/scenarios/multi-platform-fallback.md)

## 功能特性

- 🔄 **格式互转**: 支持 OpenAI 和 Anthropic 两种 API 格式互相转换
- 🌊 **流式响应**: 完整支持流式响应的格式转换
- 💾 **Cache Token**: 支持 Cache Token 加速
- 🔥 **配置热加载**: 修改配置文件后自动生效
- 📊 **统计 Dashboard**: Web 界面查看请求统计和 Token 用量
- 🎯 **后台模式**: 支持守护进程方式运行

## 快速开始

### 安装

```bash
pnpm install
pnpm build
```

### 配置

创建配置文件 `~/.llm-gateway/config.json`:

```json
{
  "models": [
    {
      "customModel": "my-gpt4",
      "realModel": "gpt-4",
      "apiKey": "sk-你的 OpenAI 密钥",
      "provider": "openai",
      "baseUrl": "https://api.openai.com",
      "desc": "用于日常对话的 GPT-4 模型"
    },
    {
      "customModel": "my-claude",
      "realModel": "claude-3-5-sonnet-20241022",
      "apiKey": "sk-ant-你的 Anthropic 密钥",
      "provider": "anthropic",
      "baseUrl": "https://api.anthropic.com",
      "desc": "用于长文本处理的 Claude 模型"
    }
  ]
}
```

### 启动

```bash
# 前台启动
pnpm start

# 后台启动
pnpm start -- --daemon

# 或使用全局命令（安装后）
llm-gateway-start
llm-gateway-stats
```

### 使用

```bash
# OpenAI 格式
curl http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "my-gpt4",
    "messages": [{"role": "user", "content": "你好"}]
  }'

# Anthropic 格式
curl http://localhost:4000/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "my-claude",
    "messages": [{"role": "user", "content": "你好"}],
    "max_tokens": 1024
  }'
```

### 管理界面

- **首页**: http://localhost:4000/user/main
- **模型管理**: http://localhost:4000/admin/models
- **统计 Dashboard**: http://localhost:4000/admin/stats
- **密码管理**: http://localhost:4000/admin/password

> 🔐 首次访问管理后台时会自动提示设置密码，保护管理界面不被未授权访问。

## 文档

- 详细使用教程：[docs/user-guide.md](docs/user-guide.md)
- Admin 密码认证功能：[docs/admin-password.md](docs/admin-password.md)

## 开发心得

- [全程使用 Qwen Code 编程](docs/development/use-qwen-code.md)
- [Cache Token 实现的艰辛](docs/development/cache-token-struggle.md)
- [龙猫平台 Omni 模型兼容性问题](docs/development/longcat-omni-bug.md)

## License

MIT