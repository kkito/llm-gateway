# LLM Proxy 使用教程

## 什么是 LLM Proxy

LLM Proxy 是一个简单的代理服务器，帮你统一管理多个大模型 API。

**作用**：
- 用一个固定的地址调用不同的大模型（OpenAI、Anthropic 等）
- 自定义模型名称，方便切换
- 自动记录请求日志，方便查看用量
- 提供 Web 管理界面，实时查看统计数据

---

## 快速开始

### 第 1 步：写配置文件

创建配置文件（默认路径 `~/.llm-gateway/config.json`）：

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

### 第 2 步：启动服务

**前台启动**（占用终端）：

```bash
llm-gateway-start
```

或者指定配置文件：

```bash
llm-gateway-start --config ./config.json --port 4000
```

**后台启动**（守护进程模式）：

```bash
llm-gateway-start --daemon
# 或简写
llm-gateway-start -D
```

后台启动后可以自由使用终端，服务会在后台运行。

**停止后台服务**：

```bash
llm-gateway-start --stop
```

看到以下提示表示启动成功：

```
🚀 LLM Proxy 已启动
   端口：http://localhost:4000
   健康检查：http://localhost:4000/health
```

### 第 3 步：调用 API

```bash
curl http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "my-gpt4",
    "messages": [{"role": "user", "content": "你好"}]
  }'
```

---

## 配置文件详解

配置文件是一个对象，包含 `models` 数组：

```json
{
  "models": [
    {
      "customModel": "my-gpt4",        // 你自定义的模型名称（调用时用这个）
      "realModel": "gpt-4",            // 实际调用的上游模型名称
      "apiKey": "sk-xxx",              // 上游 API 密钥
      "baseUrl": "https://api.openai.com"  // 上游 API 地址
      "provider": "openai"             // 提供商类型
    }
  ]
}
```

**字段说明**：

| 字段 | 含义 | 示例 |
|------|------|------|
| `customModel` | 你起的名字，调用 API 时用 | `my-gpt4`、`my-claude` |
| `realModel` | 实际调用的模型 | `gpt-4`、`claude-3-5-sonnet-20241022` |
| `apiKey` | 你的 API 密钥 | `sk-xxx`、`sk-ant-xxx` |
| `baseUrl` | API 提供商的地址 | `https://api.openai.com` |
| `provider` | API 提供商类型 | `openai`、`anthropic` |

**注意**：旧版本的数组格式配置仍然兼容，系统会自动转换。

---

## 启动命令参数

```bash
llm-gateway-start [选项]
```

**常用参数**：

| 参数 | 简写 | 默认值 | 说明 |
|------|------|--------|------|
| `--dir` | `-d` | `~/.llm-gateway/` | 工作目录 |
| `--config` | `-c` | `~/.llm-gateway/config.json` | 配置文件路径 |
| `--log-dir` | `-l` | `~/.llm-gateway/logs/proxy` | 日志存放目录 |
| `--port` | `-p` | `4000` | 服务端口 |
| `--timeout` | `-t` | `300000` | 请求超时时间（毫秒） |
| `--daemon` | `-D` | - | 后台启动（守护进程模式） |
| `--debug` | - | - | 启用详细日志（记录完整请求/响应内容到文件） |
| `--stop` | - | - | 停止后台运行的服务 |

**优先级**：`--config` / `--log-dir` > `--dir` > 默认 `~/.llm-gateway/`

**示例**：

```bash
# 使用默认目录 ~/.llm-gateway/
llm-gateway-start

# 指定自定义工作目录
llm-gateway-start -d ./my-proxy

# 使用自定义配置文件和端口
llm-gateway-start -c ./my-config.json -p 8080

# 指定日志目录
llm-gateway-start -c ./config.json -l ./my-logs

# 后台启动（守护进程模式）
llm-gateway-start --daemon -p 8080

# 停止后台服务
llm-gateway-start --stop
```

---

## 调用 API

### OpenAI 格式

**地址**：`POST http://localhost:4000/v1/chat/completions`

**请求**：

```bash
curl http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "my-gpt4",
    "messages": [
      {"role": "system", "content": "你是一个助手"},
      {"role": "user", "content": "你好"}
    ],
    "stream": false
  }'
```

### Anthropic 格式

**地址**：`POST http://localhost:4000/v1/messages`

**请求**：

```bash
curl http://localhost:4000/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "my-claude",
    "messages": [
      {"role": "user", "content": "你好"}
    ],
    "max_tokens": 1024
  }'
```

---

## 查看统计

### Web Dashboard（推荐）

启动代理服务器后，访问 **http://localhost:4000/admin/stats** 即可查看可视化统计页面。

**功能**：
- 📊 概览卡片：总请求数、成功率、Token 用量
- 🤖 按模型统计：每个模型的请求数、Token 消耗、缓存命中
- ☁️ 按 Provider 统计：OpenAI、Anthropic 等提供商的用量
- 🕐 按小时分布：可视化柱状图展示每小时请求分布
- 📅 日期范围选择：支持按日期、周、月份查询

**访问步骤**：
1. 启动代理服务器：`llm-gateway-start`
2. 浏览器打开：http://localhost:4000/admin/stats
3. 使用页面上的日期选择器切换不同时间范围

### 命令行统计

#### 查看今日统计

```bash
llm-gateway-stats
```

或者指定日志目录：

```bash
llm-gateway-stats --log-dir ./logs/proxy
```

**输出示例**：

```
=== LLM Proxy Stats (今日) ===

总请求数：1234
成功请求：1200
失败请求：34
成功率：97.3%

按模型统计:
    my-gpt4: 800 次
      - 输入：80,000 tokens
      - 输出：40,000 tokens
      - 总计：120,000 tokens
      - 缓存：10,000 tokens
    my-claude: 400 次
      - 输入：40,000 tokens
      - 输出：20,000 tokens
      - 总计：60,000 tokens

按 provider 统计:
    openai: 800 次
    anthropic: 400 次

Token 总计:
  总输入：120,000 tokens
  总输出：60,000 tokens
  总计：180,000 tokens
  缓存命中：10,000 tokens
```

#### 按日期/周/月查询

```bash
# 指定日期
llm-gateway-stats --date 2026-03-25

# 按小时分布
llm-gateway-stats --date 2026-03-25 --by-hour

# 指定周
llm-gateway-stats --week 2026-W13

# 指定月份
llm-gateway-stats --month 2026-03
```

#### 输出 JSON 格式

```bash
llm-gateway-stats --log-dir ./logs/proxy --json
```

---

## 日志文件

日志存放在 `--log-dir` 指定的目录（默认 `~/.llm-gateway/logs/proxy`），按天存储：

```
~/.llm-gateway/logs/proxy/
├── proxy-2026-03-21.log
├── proxy-2026-03-22.log
└── proxy-2026-03-23.log
```

每行是一条请求记录（JSON 格式），包含：
- 请求时间
- 使用的模型
- 请求耗时
- Token 用量
- 是否成功

---

## 测试场景

### 跑通了几个场景

- [logncat](https://longcat.chat/platform/usage) `LongCat-Flash-Lite` 配置好了之后可以跑`claude` / `qwen`
- [移动云minimax](https://ecloud.10086.cn/portal/act/codingplan) 官方给了claude和opencode两种方式， 任意一种， 跑`claude` 和 `qwen`都可以

---

## 常见问题

### Q: 如何停止服务？

**前台模式**：按 `Ctrl + C` 即可停止。

**后台模式**：执行以下命令停止后台服务：

```bash
llm-gateway-start --stop
```

或者直接 kill 进程：

```bash
kill <PID>
```

---

### Q: 如何后台启动服务？

使用 `--daemon` 或 `-D` 参数即可：

```bash
llm-gateway-start --daemon -p 8080
```

启动后会显示进程 PID，方便你管理。

---

### Q: 如何查看后台服务的状态？

可以通过健康检查接口查看：

```bash
curl http://localhost:4000/health
```

或者查看 PID 文件（`~/.llm-gateway/llm-proxy.pid`）确认服务是否在运行。

---

### Q: 配置文件可以放多个模型吗？

可以！在 `models` 数组中放任意多个模型配置：

```json
{
  "models": [
    {"customModel": "model-1", ...},
    {"customModel": "model-2", ...},
    {"customModel": "model-3", ...}
  ]
}
```

---

### Q: 调用时提示 "Model not found"？

检查你调用的 `model` 名称是否与配置中的 `customModel` 一致。

---

### Q: 如何修改端口？

启动时加 `-p` 参数：

```bash
llm-gateway-start -p 8080
```

---

### Q: 日志文件太大怎么办？

日志按天存储，可以定期删除旧日志文件。

---

## 下一步

- 查看设计文档：`docs/superpowers/specs/2026-03-21-llm-proxy-design.md`
- 查看格式转换说明：`src/proxy/docs/myproxy_anthropic_openai_conversion.md`
