#!/usr/bin/env bash
#
# 响应验证工具
# 用于验证 LLM Gateway 返回的响应是否符合预期格式
#

set -euo pipefail

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 验证结果计数
PASS_COUNT=0
FAIL_COUNT=0

# 打印通过
pass() {
    echo -e "${GREEN}[PASS]${NC} $1"
    ((PASS_COUNT++))
}

# 打印失败
fail() {
    echo -e "${RED}[FAIL]${NC} $1"
    ((FAIL_COUNT++))
}

# 打印警告
warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# 打印标题
section() {
    echo -e "\n${YELLOW}=== $1 ===${NC}"
}

# 验证非流式 JSON 响应
# 参数: $1 = 响应内容 (JSON 字符串)
validate_json_response() {
    local response="$1"
    local errors=()

    section "验证非流式响应"

    # 1. 验证是否为有效 JSON
    if ! echo "$response" | jq empty 2>/dev/null; then
        fail "响应不是有效的 JSON 格式"
        return 1
    fi
    pass "响应是有效的 JSON 格式"

    # 2. 验证必需字段
    local required_fields=("id" "object" "created" "model" "choices" "usage")
    for field in "${required_fields[@]}"; do
        if echo "$response" | jq -e ".$field" >/dev/null 2>&1; then
            pass "包含字段: $field"
        else
            fail "缺少字段: $field"
            errors+=("$field")
        fi
    done

    # 3. 验证 object 字段值
    local object_value
    object_value=$(echo "$response" | jq -r '.object' 2>/dev/null)
    if [[ "$object_value" == "chat.completion" ]]; then
        pass "object 值为 'chat.completion'"
    else
        fail "object 值应为 'chat.completion'，实际为: $object_value"
    fi

    # 4. 验证 choices 数组
    local choices_length
    choices_length=$(echo "$response" | jq '.choices | length' 2>/dev/null)
    if [[ "$choices_length" -gt 0 ]]; then
        pass "choices 数组长度: $choices_length"
    else
        fail "choices 数组为空"
    fi

    # 5. 验证 choices[0] 结构
    if echo "$response" | jq -e '.choices[0]' >/dev/null 2>&1; then
        pass "choices[0] 存在"

        # 验证 message 字段
        if echo "$response" | jq -e '.choices[0].message' >/dev/null 2>&1; then
            pass "choices[0].message 存在"

            # 验证 role
            local role
            role=$(echo "$response" | jq -r '.choices[0].message.role' 2>/dev/null)
            if [[ "$role" == "assistant" ]]; then
                pass "message.role 为 'assistant'"
            else
                fail "message.role 应为 'assistant'，实际为: $role"
            fi

            # 验证 content 不为空
            local content
            content=$(echo "$response" | jq -r '.choices[0].message.content // empty' 2>/dev/null)
            if [[ -n "$content" ]]; then
                pass "message.content 不为空 (${#content} 字符)"
            else
                fail "message.content 为空"
            fi
        else
            fail "choices[0].message 不存在"
        fi

        # 验证 finish_reason
        local finish_reason
        finish_reason=$(echo "$response" | jq -r '.choices[0].finish_reason' 2>/dev/null)
        if [[ -n "$finish_reason" && "$finish_reason" != "null" ]]; then
            pass "finish_reason: $finish_reason"
        else
            fail "finish_reason 为空或缺失"
        fi
    else
        fail "choices[0] 不存在"
    fi

    # 6. 验证 usage 结构
    if echo "$response" | jq -e '.usage' >/dev/null 2>&1; then
        pass "usage 存在"

        local usage_fields=("prompt_tokens" "completion_tokens" "total_tokens")
        for field in "${usage_fields[@]}"; do
            local value
            value=$(echo "$response" | jq -r ".usage.$field // empty" 2>/dev/null)
            if [[ -n "$value" && "$value" =~ ^[0-9]+$ ]]; then
                pass "usage.$field: $value"
            else
                fail "usage.$field 缺失或不是有效数字"
            fi
        done
    else
        fail "usage 对象不存在"
    fi

    # 打印验证结果
    echo ""
    echo "=================================="
    echo -e "验证结果: ${GREEN}$PASS_COUNT 通过${NC}, ${RED}$FAIL_COUNT 失败${NC}"
    echo "=================================="

    return $FAIL_COUNT
}

# 验证流式 SSE 响应
# 参数: $1 = 响应文件路径
validate_stream_response() {
    local response_file="$1"
    local errors=()

    section "验证流式响应"

    # 1. 验证文件存在
    if [[ ! -f "$response_file" ]]; then
        fail "响应文件不存在: $response_file"
        return 1
    fi

    # 2. 验证包含 data: 前缀的行
    local data_lines
    data_lines=$(grep -c "^data: " "$response_file" 2>/dev/null || true)
    if [[ "$data_lines" -gt 0 ]]; then
        pass "包含 $data_lines 行 SSE 数据 (data: 前缀)"
    else
        fail "未找到 SSE 格式数据 (data: 前缀)"
    fi

    # 3. 验证 [DONE] 标记
    if grep -q "data: \[DONE\]" "$response_file"; then
        pass "包含 [DONE] 结束标记"
    else
        fail "缺少 [DONE] 结束标记"
    fi

    # 4. 验证至少有一个 chunk 包含 choices
    if grep "^data: " "$response_file" | grep -v "\[DONE\]" | grep -q "choices"; then
        pass "至少一个 chunk 包含 choices 字段"
    else
        fail "没有 chunk 包含 choices 字段"
    fi

    # 5. 验证第一个 chunk 的格式
    local first_data_line
    first_data_line=$(grep "^data: " "$response_file" | grep -v "\[DONE\]" | head -1)
    if [[ -n "$first_data_line" ]]; then
        local json_part="${first_data_line#data: }"
        if echo "$json_part" | jq empty 2>/dev/null; then
            pass "第一个 chunk 是有效的 JSON"

            # 验证必需字段
            local stream_fields=("id" "object" "model" "choices")
            for field in "${stream_fields[@]}"; do
                if echo "$json_part" | jq -e ".$field" >/dev/null 2>&1; then
                    pass "chunk 包含字段: $field"
                else
                    warn "chunk 缺少字段: $field (某些 chunk 可能不包含)"
                fi
            done
        else
            fail "第一个 chunk 不是有效的 JSON"
        fi
    fi

    # 6. 验证最后一个数据 chunk 包含 usage
    local last_data_before_done
    last_data_before_done=$(grep "^data: " "$response_file" | grep -v "\[DONE\]" | tail -1)
    if [[ -n "$last_data_before_done" ]]; then
        local json_part="${last_data_before_done#data: }"
        if echo "$json_part" | jq -e '.usage' >/dev/null 2>&1; then
            pass "最后一个数据 chunk 包含 usage 信息"

            # 验证 usage 字段
            local usage_fields=("prompt_tokens" "completion_tokens" "total_tokens")
            for field in "${usage_fields[@]}"; do
                local value
                value=$(echo "$json_part" | jq -r ".usage.$field // empty" 2>/dev/null)
                if [[ -n "$value" && "$value" =~ ^[0-9]+$ ]]; then
                    pass "usage.$field: $value"
                else
                    warn "usage.$field 缺失或不是有效数字 (某些响应可能不包含)"
                fi
            done
        else
            warn "最后一个数据 chunk 不包含 usage (某些响应可能不包含)"
        fi
    fi

    # 7. 验证 content 不为空（从所有 chunk 中累积）
    local total_content
    total_content=$(grep "^data: " "$response_file" | grep -v "\[DONE\]" | while read -r line; do
        local json_part="${line#data: }"
        echo "$json_part" | jq -r '.choices[0].delta.content // empty' 2>/dev/null
    done | tr -d '\n')

    if [[ -n "$total_content" ]]; then
        pass "累积 content 内容不为空 (${#total_content} 字符)"
    else
        # 检查是否有 reasoning_content
        local total_reasoning
        total_reasoning=$(grep "^data: " "$response_file" | grep -v "\[DONE\]" | while read -r line; do
            local json_part="${line#data: }"
            echo "$json_part" | jq -r '.choices[0].delta.reasoning // empty' 2>/dev/null
        done | tr -d '\n')

        if [[ -n "$total_reasoning" ]]; then
            pass "累积 reasoning_content 内容不为空 (${#total_reasoning} 字符)"
        else
            fail "累积 content 和 reasoning_content 都为空"
        fi
    fi

    # 打印验证结果
    echo ""
    echo "=================================="
    echo -e "验证结果: ${GREEN}$PASS_COUNT 通过${NC}, ${RED}$FAIL_COUNT 失败${NC}"
    echo "=================================="

    return $FAIL_COUNT
}

# 验证 HTTP 响应状态码
# 参数: $1 = HTTP 状态码
validate_http_status() {
    local status_code="$1"

    section "验证 HTTP 状态码"

    if [[ "$status_code" -eq 200 ]]; then
        pass "HTTP 状态码: $status_code"
    elif [[ "$status_code" -ge 400 ]]; then
        fail "HTTP 错误状态码: $status_code"
    else
        warn "HTTP 状态码: $status_code (非 200)"
    fi
}

# 重置计数器
reset_counters() {
    PASS_COUNT=0
    FAIL_COUNT=0
}
