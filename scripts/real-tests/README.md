# LLM Gateway 真实场景测试

这个目录包含了用于测试 LLM Gateway 服务的真实场景测试脚本。与单元测试不同，这些测试使用**真实的上游 API**，验证服务在真实环境中的行为。

## 目录结构

```
scripts/real-tests/
├── README.md                  # 本文件
├── run.sh                     # 主入口脚本（交互式启动）
├── utils/
│   └── validate.sh            # 通用响应验证工具
└── scenarios/
    ├── openai-provider/       # OpenAI endpoint + OpenAI provider 场景
    │   ├── test.sh            # 测试执行脚本
    │   └── DESCRIPTION        # 场景描述
    └── anthropic-provider/    # Anthropic endpoint + OpenAI provider 场景
        ├── test.sh            # 测试执行脚本
        ├── tools.json         # Anthropic 格式工具定义
        └── DESCRIPTION        # 场景描述
```

## 快速开始

### 1. 确保服务运行

在运行测试之前，确保 LLM Gateway 服务正在运行：

```bash
# 启动服务（前台）
pnpm start

# 或后台启动
pnpm start -- --daemon
```

### 2. 运行测试

```bash
# 交互式运行（推荐）
bash scripts/real-tests/run.sh

# 或直接调用特定场景
bash scripts/real-tests/scenarios/openai-provider/test.sh http://localhost:4000 your-model-name
```

### 3. 交互流程

运行 `run.sh` 后，脚本会提示你输入：

1. **测试地址** - 例如 `http://localhost:4000`
2. **测试场景** - 从列表中选择一个
3. **模型名称** - 你在配置中定义的模型名称（例如 `current-model`）

## 测试规则

### 核心原则

1. **所有测试均为流式请求**（`stream: true`），非流式请求不需要测试
2. **每个测试场景必须包含**：
   - 正常对话流程（用户提问，模型回答）
   - 至少 2 个工具调用（如 `list_directory`、`write_file` 等）

### 为什么只测试流式？

- 真实业务场景中，客户端几乎都使用流式请求
- 流式响应能更好地测试 SSE 格式转换、tool_calls 流式输出等关键路径
- 非流式请求的测试覆盖率较低，优先级低于流式

## 测试场景

### OpenAI Provider (直传模式)

**场景描述**: 客户端发送 OpenAI 格式请求，网关直接转发给 OpenAI 上游，无需格式转换。

**测试内容**:
- ✅ 流式对话 + 工具调用（主要测试场景）
  - 验证响应是 SSE 格式 (`data:` 前缀)
  - 验证 `[DONE]` 结束标记存在
  - 验证 chunk 包含正确的字段
  - 验证累积 content 不为空
  - 验证消息中包含 `tool_calls` 和 `tool` 角色
  - 验证响应中包含 `tool_calls`（id, type, function.name, function.arguments）
  - 验证最后一个 chunk 包含 `usage` 信息

### Anthropic Provider (格式转换模式)

**场景描述**: 客户端发送 Anthropic 格式请求（`/v1/messages`），网关将其转换为 OpenAI 格式后转发给 OpenAI 上游。

**测试内容**:
- ✅ 流式对话 + 工具调用（主要测试场景）
  - 验证响应是 Anthropic SSE 格式 (`event:` + `data:` 前缀)
  - 验证 `content_block_*` 事件序列正确
  - 验证累积 text content 不为空
  - 验证包含 `tool_use` 类型的 content block
  - 验证 tool_use 包含 id, name, input 字段
  - 验证包含 usage 信息（input_tokens, output_tokens）

## 如何添加新的测试场景

### 1. 创建场景目录

```bash
mkdir -p scripts/real-tests/scenarios/<scenario-name>
```

### 2. 创建请求模板

在场景目录中创建请求 JSON 文件：

```json
{
  "model": "REPLACE_MODEL_NAME",
  "messages": [
    {"role": "user", "content": "Hello"}
  ],
  "stream": false
}
```

**重要**: 使用 `REPLACE_MODEL_NAME` 作为模型名称的占位符，脚本会自动替换。

### 3. 创建测试脚本

创建 `test.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UTILS_DIR="$(cd "$SCRIPT_DIR/../../utils" && pwd)"
source "$UTILS_DIR/validate.sh"

BASE_URL="${1:-}"
MODEL_NAME="${2:-}"

# 你的测试逻辑
curl -X POST "$BASE_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d "your-request.json"
```

### 4. 创建场景描述（可选）

创建 `DESCRIPTION` 文件，包含场景的简短描述：

```
OpenAI endpoint + Anthropic provider (格式转换模式)
```

## 验证规则

### 非流式响应验证

| 验证项 | 期望值 |
|--------|--------|
| HTTP 状态码 | 200 |
| Content-Type | application/json |
| `object` | "chat.completion" |
| `choices` | 非空数组 |
| `choices[0].message.role` | "assistant" |
| `choices[0].message.content` | 非空字符串 |
| `choices[0].finish_reason` | "stop" 或 "length" |
| `usage.prompt_tokens` | 数字 |
| `usage.completion_tokens` | 数字 |
| `usage.total_tokens` | 数字 |

### 流式响应验证

| 验证项 | 期望值 |
|--------|--------|
| HTTP 状态码 | 200 |
| Content-Type | text/event-stream |
| 行格式 | 以 `data: ` 开头 |
| 结束标记 | 包含 `data: [DONE]` |
| chunk 格式 | 有效的 JSON |
| 累积 content | 非空 |
| 最后 chunk usage | 包含 token 统计 |

## 常见问题

### Q: 测试失败，显示 "连接被拒绝"

**A**: 确保服务正在运行且地址正确：

```bash
# 检查服务是否运行
curl http://localhost:4000/health

# 应该返回: {"status":"ok"}
```

### Q: 测试失败，显示 "404 Model not found"

**A**: 确保你输入的模型名称与配置文件中的 `customModel` 匹配：

```bash
# 查看配置
cat ~/.llm-gateway/config.json
```

### Q: 流式测试超时

**A**: 可能原因：
1. 上游 API 响应慢（检查网络）
2. `max_tokens` 设置过大
3. 上游 API 不可用

### Q: 验证通过但内容为空

**A**: 可能原因：
1. 上游 API 返回空响应
2. 请求格式不被上游接受
3. 模型不支持该请求格式

## 扩展测试

### 添加带 tools 的测试

创建 `request-with-tools.json`：

```json
{
  "model": "REPLACE_MODEL_NAME",
  "messages": [
    {"role": "user", "content": "查看当前目录的文件"}
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "list_directory",
        "description": "List files in a directory",
        "parameters": {
          "type": "object",
          "properties": {
            "path": {"type": "string"}
          },
          "required": ["path"]
        }
      }
    }
  ],
  "stream": false
}
```

### 添加 Anthropic provider 测试

创建场景目录 `scripts/real-tests/scenarios/anthropic-provider/`，然后按照上述步骤创建相应的测试文件。

## 贡献

如果你添加了新的测试场景，欢迎提交 PR。请确保：

1. 请求模板使用 `REPLACE_MODEL_NAME` 占位符
2. 测试脚本接受 `$1` (BASE_URL) 和 `$2` (MODEL_NAME) 参数
3. 创建 `DESCRIPTION` 文件描述场景
4. 更新本 README 文档
