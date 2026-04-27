#!/usr/bin/env bash
#
# LLM Gateway 真实场景测试 - 主入口脚本
# 用于启动各种真实场景的测试
#

set -euo pipefail

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# 脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCENARIOS_DIR="$SCRIPT_DIR/scenarios"

# 标题
echo -e "${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║        LLM Gateway 真实场景测试                         ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# 1. 让用户输入测试地址
echo -e "${CYAN}请输入测试地址 (例如: http://localhost:4000)${NC}"
read -p "> " BASE_URL

# 验证地址格式
if [[ ! "$BASE_URL" =~ ^https?:// ]]; then
    echo -e "${RED}错误: 地址格式不正确，应以 http:// 或 https:// 开头${NC}"
    exit 1
fi

echo ""
echo -e "测试地址已设置: ${GREEN}$BASE_URL${NC}"
echo ""

# 2. 显示可用的测试场景
echo -e "${CYAN}可用的测试场景:${NC}"
echo ""

SCENARIOS=()
SCENARIO_NAMES=()
SCENARIO_DESCS=()

index=1
for scenario_dir in "$SCENARIOS_DIR"/*/; do
    if [[ -d "$scenario_dir" ]]; then
        scenario_name=$(basename "$scenario_dir")
        SCENARIOS+=("$scenario_name")
        SCENARIO_NAMES+=("$scenario_name")
        
        # 读取描述（如果有）
        desc_file="$scenario_dir/DESCRIPTION"
        if [[ -f "$desc_file" ]]; then
            desc=$(cat "$desc_file")
        else
            desc="测试场景: $scenario_name"
        fi
        SCENARIO_DESCS+=("$desc")
        
        echo -e "  ${YELLOW}[$index]${NC} $scenario_name"
        echo -e "      $desc"
        echo ""
        
        ((index++))
    fi
done

if [[ ${#SCENARIOS[@]} -eq 0 ]]; then
    echo -e "${RED}错误: 未找到任何测试场景${NC}"
    exit 1
fi

# 3. 让用户选择场景
echo -e "${CYAN}请选择要运行的场景 (输入编号)${NC}"
read -p "> " SCENARIO_INDEX

if [[ ! "$SCENARIO_INDEX" =~ ^[0-9]+$ ]] || [[ "$SCENARIO_INDEX" -lt 1 ]] || [[ "$SCENARIO_INDEX" -gt ${#SCENARIOS[@]} ]]; then
    echo -e "${RED}错误: 无效的场景编号${NC}"
    exit 1
fi

SELECTED_SCENARIO="${SCENARIOS[$((SCENARIO_INDEX - 1))]}"
echo ""
echo -e "已选择场景: ${GREEN}$SELECTED_SCENARIO${NC}"
echo ""

# 4. 如果需要模型名称，提示用户输入
echo -e "${CYAN}请输入要测试的模型名称 (例如: current-model, my-gpt4)${NC}"
read -p "> " MODEL_NAME

if [[ -z "$MODEL_NAME" ]]; then
    echo -e "${RED}错误: 模型名称不能为空${NC}"
    exit 1
fi

echo ""
echo -e "模型名称已设置: ${GREEN}$MODEL_NAME${NC}"
echo ""

# 5. 运行测试
TEST_SCRIPT="$SCENARIOS_DIR/$SELECTED_SCENARIO/test.sh"

if [[ ! -f "$TEST_SCRIPT" ]]; then
    echo -e "${RED}错误: 测试脚本不存在: $TEST_SCRIPT${NC}"
    exit 1
fi

echo -e "${CYAN}开始运行测试...${NC}"
echo ""

# 执行测试脚本
bash "$TEST_SCRIPT" "$BASE_URL" "$MODEL_NAME"
