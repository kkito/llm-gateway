# LLM Gateway

LLM Proxy Gateway - 统一管理多个大模型 API 的代理服务器

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
      "baseUrl": "https://api.openai.com"
    },
    {
      "customModel": "my-claude",
      "realModel": "claude-3-5-sonnet-20241022",
      "apiKey": "sk-ant-你的 Anthropic 密钥",
      "provider": "anthropic",
      "baseUrl": "https://api.anthropic.com"
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

## 文档

详细使用教程请参考 [docs/README.md](docs/README.md)

## License

MIT
