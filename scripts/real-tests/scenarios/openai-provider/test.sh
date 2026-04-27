#!/usr/bin/env bash
#
# OpenAI Provider 场景测试脚本
# 测试 OpenAI endpoint + OpenAI provider (直传模式)
# 所有测试均为流式请求，包含正常对话和工具调用
#

set -uo pipefail

# 脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UTILS_DIR="$(cd "$SCRIPT_DIR/../../utils" && pwd)"

# 加载验证工具
source "$UTILS_DIR/validate.sh"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# 测试配置
BASE_URL="${1:-}"
MODEL_NAME="${2:-}"

if [[ -z "$BASE_URL" || -z "$MODEL_NAME" ]]; then
    echo -e "${RED}错误: 缺少必要参数${NC}"
    echo "用法: $0 <BASE_URL> <MODEL_NAME>"
    exit 1
fi

# 临时目录
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

# 提取响应中的 content 内容
extract_content() {
    local response_file="$1"
    local result=""
    while IFS= read -r line; do
        if [[ "$line" == data:\ * && "$line" != *"data: [DONE]"* ]]; then
            local json_part="${line#data: }"
            local content
            content=$(echo "$json_part" | jq -r '.choices[0].delta.content // empty' 2>/dev/null || true)
            if [[ -n "$content" ]]; then
                result="${result}${content}"
            fi
        fi
    done < "$response_file"
    echo "$result"
}

# 提取响应中的 tool_calls
extract_tool_calls() {
    local response_file="$1"
    while IFS= read -r line; do
        if [[ "$line" == data:\ * && "$line" != *"data: [DONE]"* ]]; then
            local json_part="${line#data: }"
            local tc
            tc=$(echo "$json_part" | jq -c '.choices[0].delta.tool_calls // empty' 2>/dev/null || true)
            if [[ -n "$tc" && "$tc" != "null" && "$tc" != "" ]]; then
                echo "$tc"
                return
            fi
        fi
    done < "$response_file"
}

# 提取 usage 信息
extract_usage() {
    local response_file="$1"
    local last_chunk=""
    while IFS= read -r line; do
        if [[ "$line" == data:\ * && "$line" != *"data: [DONE]"* ]]; then
            last_chunk="$line"
        fi
    done < "$response_file"
    
    if [[ -n "$last_chunk" ]]; then
        local json_part="${last_chunk#data: }"
        echo "$json_part" | jq -c '.usage // empty' 2>/dev/null || true
    fi
}

# 运行测试用例
run_case() {
    local case_name="$1"
    local request_file="$2"
    local expect_tool="${3:-}"  # 可选: 期望触发的工具名称
    
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}Case: $case_name${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    
    local response_file="$TEMP_DIR/response_$(date +%s).txt"
    
    # 显示请求摘要
    echo -e "${CYAN}请求摘要:${NC}"
    local model stream max_tokens
    model=$(jq -r '.model' "$request_file")
    stream=$(jq -r '.stream' "$request_file")
    max_tokens=$(jq -r '.max_tokens // "默认"' "$request_file")
    
    echo "  - 模型: $model"
    echo "  - 流式: $stream"
    echo "  - max_tokens: $max_tokens"
    
    # 显示工具列表（如果有）
    local tools_count
    tools_count=$(jq '.tools | length' "$request_file" 2>/dev/null || echo "0")
    if [[ "$tools_count" -gt 0 ]]; then
        echo -n "  - 工具: "
        jq -r '[.tools[].function.name] | join(", ")' "$request_file"
    fi
    
    echo ""
    
    # 发送请求（记录耗时）
    local start_time end_time duration
    start_time=$(date +%s%N)
    
    curl -s \
        -X POST "$BASE_URL/v1/chat/completions" \
        -H "Content-Type: application/json" \
        -d @"$request_file" \
        -o "$response_file" \
        -w "%{http_code}" > "$TEMP_DIR/http_code.txt"
    
    end_time=$(date +%s%N)
    duration=$(( (end_time - start_time) / 1000000 ))  # 转换为毫秒
    
    local http_code
    http_code=$(cat "$TEMP_DIR/http_code.txt")
    
    # 验证结果
    if [[ "$http_code" -eq 200 ]]; then
        local content tool_calls usage
        content=$(extract_content "$response_file")
        tool_calls=$(extract_tool_calls "$response_file")
        usage=$(extract_usage "$response_file")
        
        echo -e "${GREEN}✓ 成功${NC} (${duration}ms)"
        echo ""
        
        # 检测工具调用
        if [[ -n "$expect_tool" ]]; then
            if [[ -n "$tool_calls" && "$tool_calls" != "null" ]]; then
                local called_tool
                called_tool=$(echo "$tool_calls" | jq -r '.[0].function.name // empty' 2>/dev/null || true)
                if [[ "$called_tool" == "$expect_tool" ]]; then
                    echo -e "${GREEN}✓ 触发了工具调用: $called_tool${NC}"
                else
                    echo -e "${YELLOW}⚠ 触发了工具调用，但不是期望的工具: $called_tool (期望: $expect_tool)${NC}"
                fi
                echo ""
            else
                echo -e "${RED}✗ 未触发工具调用 (期望: $expect_tool)${NC}"
                echo ""
            fi
        fi
        
        if [[ -n "$content" ]]; then
            echo -e "${CYAN}返回内容:${NC}"
            echo ""
            echo "$content" | fold -w 80 -s
            echo ""
        fi
        
        if [[ -n "$tool_calls" && "$tool_calls" != "null" ]]; then
            echo -e "${CYAN}工具调用详情:${NC}"
            echo "$tool_calls" | jq . 2>/dev/null || echo "  $tool_calls"
            echo ""
        fi
        
        if [[ -n "$usage" ]]; then
            local prompt_tokens completion_tokens
            prompt_tokens=$(echo "$usage" | jq -r '.prompt_tokens // 0' 2>/dev/null || echo "0")
            completion_tokens=$(echo "$usage" | jq -r '.completion_tokens // 0' 2>/dev/null || echo "0")
            
            echo -e "${CYAN}Token 消耗:${NC}"
            echo "  - 输入: $prompt_tokens tokens"
            echo "  - 输出: $completion_tokens tokens"
            echo ""
        fi
        
        local chunks=0
        while IFS= read -r line; do
            if [[ "$line" == data:\ * ]]; then
                ((chunks++)) || true
            fi
        done < "$response_file"
        echo -e "${CYAN}响应信息:${NC}"
        echo "  - Chunk 数量: $chunks"
        echo ""
    else
        echo -e "${RED}✗ 失败 (HTTP $http_code)${NC} (${duration}ms)"
        echo ""
    fi
}

echo -e "${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║          OpenAI Provider 真实场景测试                    ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "测试地址: ${YELLOW}$BASE_URL${NC}"
echo -e "模型名称: ${YELLOW}$MODEL_NAME${NC}"
echo ""

# 加载 tools 定义
TOOLS_FILE="$SCRIPT_DIR/tools.json"
if [[ ! -f "$TOOLS_FILE" ]]; then
    echo -e "${RED}错误: 找不到 tools.json 文件${NC}"
    exit 1
fi
TOOLS_JSON=$(cat "$TOOLS_FILE")

# ============================================
# Case 1: 常规对话
# ============================================
CASE1_FILE="$TEMP_DIR/case1.json"
cat > "$CASE1_FILE" <<EOF
{
  "model": "$MODEL_NAME",
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant. Please respond in Chinese."
    },
    {
      "role": "user",
      "content": "请用一句话介绍你自己"
    }
  ],
  "stream": true,
  "max_tokens": 500,
  "temperature": 0.7
}
EOF

run_case "常规对话" "$CASE1_FILE"

# ============================================
# Case 2: 工具调用 - write_file
# ============================================
CASE2_FILE="$TEMP_DIR/case2.json"
jq -n \
  --arg model "$MODEL_NAME" \
  --argjson tools "$TOOLS_JSON" \
  '{
    "model": $model,
    "messages": [
      {
        "role": "system",
        "content": "You are a helpful assistant with access to tools and skills. Use tools when appropriate."
      },
      {
        "role": "user",
        "content": "请在 /tmp 目录下创建一个空的 test.txt 文件"
      }
    ],
    "tools": $tools,
    "stream": true,
    "max_tokens": 1000,
    "temperature": 0.7
  }' > "$CASE2_FILE"

run_case "工具调用 - write_file" "$CASE2_FILE" "write_file"

# ============================================
# Case 3: 工具调用 - list_directory
# ============================================
CASE3_FILE="$TEMP_DIR/case3.json"
jq -n \
  --arg model "$MODEL_NAME" \
  --argjson tools "$TOOLS_JSON" \
  '{
    "model": $model,
    "messages": [
      {
        "role": "system",
        "content": "You are a helpful assistant with access to tools and skills. Use tools when appropriate."
      },
      {
        "role": "user",
        "content": "请列出 /tmp 目录下有哪些文件"
      }
    ],
    "tools": $tools,
    "stream": true,
    "max_tokens": 1000,
    "temperature": 0.7
  }' > "$CASE3_FILE"

run_case "工具调用 - list_directory" "$CASE3_FILE" "list_directory"

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}所有测试完成${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
