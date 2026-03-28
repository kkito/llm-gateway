# 用户 API Key 使用指南

## 功能概述

LLM Gateway 支持多用户管理，每个用户可以有独立的 API Key 和使用统计。

## 快速开始

### 获取 API Key

联系管理员在后台系统中为你创建用户并获取 API Key。API Key 格式为 `sk-lg-xxxxxxxxxxxxxxx`。

### 使用 API Key

在 API 调用中，通过以下任一方式提供 API Key：

1. **Authorization Header**（推荐）:
```bash
curl -X POST http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer sk-lg-xxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4", "messages": [...]}'
```

2. **x-api-key Header**:
```bash
curl -X POST http://localhost:4000/v1/chat/completions \
  -H "x-api-key: sk-lg-xxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4", "messages": [...]}'
```

## 统计 Dashboard

访问 `http://localhost:4000/user/stats` 查看你的使用统计，包括：
- 总请求数
- Token 使用量
- 模型使用情况

## 常见问题

### Q: API Key 泄露了怎么办？
A: 联系管理员删除旧用户并创建新用户，生成新的 API Key。

### Q: 可以修改 API Key 吗？
A: 当前版本不支持修改，但可以删除后重新创建。

### Q: API Key 有使用限制吗？
A: 取决于管理员配置，目前无内置限制。
