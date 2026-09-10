// src/converters/canonical/tools.ts
/**
 * Tool 定义归一化 —— 发往上游前的最后一道兜底。
 *
 * 背景：部分客户端（Qwen Code 的 deferred tool 如 cron_list、tool_search
 * 拉取前的占位声明）会发送缺 `parameters` / `input_schema` 的 function tool。
 * JSON.stringify 会直接丢掉 undefined 字段，上游 Responses / OpenAI 严格校验
 * union 类型时匹配不上任何变体，报 400 `tools[N] did not match any supported type`。
 *
 * 本函数只补缺失的 schema，不做过滤、不删除：
 * - 非 function 类型（web_search / computer / namespace 等内置工具）原样保留；
 * - 返回路径只看 name/call_id/arguments，不受此影响。
 */

export const DEFAULT_TOOL_PARAMETERS = {
  type: 'object',
  properties: {},
} as const;

/**
 * 补齐各类形状的 function tool 缺失的 parameters/input_schema。
 * 同时兼容 OpenAI chat、Responses、Anthropic 三种形状，调用方无需区分。
 */
export function ensureToolParameters<T>(tools: T): T {
  if (!Array.isArray(tools)) return tools;
  return (tools as any[]).map((t) => {
    if (!t || typeof t !== 'object') return t;

    // OpenAI chat 形状 { type:'function', function:{ name, parameters } }
    // 含 Responses 嵌套形状 { type:'function', function:{...} }
    if ((t as any).type === 'function' && (t as any).function) {
      const fn = (t as any).function;
      if (fn.parameters == null) {
        return { ...t, function: { ...fn, parameters: { ...DEFAULT_TOOL_PARAMETERS } } };
      }
      return t;
    }

    // Responses 扁平形状 { type:'function', name, parameters }
    if ((t as any).type === 'function' && typeof (t as any).name === 'string') {
      if ((t as any).parameters == null) {
        return { ...t, parameters: { ...DEFAULT_TOOL_PARAMETERS } };
      }
      return t;
    }

    // Anthropic 裸 function 形状 { name, input_schema }（无 type 字段）
    if ((t as any).type === undefined && typeof (t as any).name === 'string') {
      if ((t as any).input_schema == null) {
        return { ...t, input_schema: { ...DEFAULT_TOOL_PARAMETERS } };
      }
      return t;
    }

    return t;
  }) as T;
}
