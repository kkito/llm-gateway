import { describe, it, expect } from 'vitest';
import { DEFAULT_TOOL_PARAMETERS, ensureToolParameters } from '../../../src/converters/canonical/tools.js';

describe('ensureToolParameters', () => {
  it('OpenAI chat 形状缺 parameters 时补默认值', () => {
    const out = ensureToolParameters([
      { type: 'function', function: { name: 'cron_list', description: 'd' } },
    ] as any);
    expect(out[0].function.parameters).toEqual({ ...DEFAULT_TOOL_PARAMETERS });
  });

  it('已有 parameters 时原样保留', () => {
    const params = { type: 'object', properties: { a: { type: 'string' } } };
    const tool = { type: 'function', function: { name: 'x', description: 'd', parameters: params } };
    const out = ensureToolParameters([tool] as any);
    expect(out[0]).toBe(tool);
    expect(out[0].function.parameters).toBe(params);
  });

  it('Responses 扁平形状缺 parameters 时补默认值', () => {
    const out = ensureToolParameters([
      { type: 'function', name: 'cron_list', description: 'd' },
    ] as any);
    expect(out[0].parameters).toEqual({ ...DEFAULT_TOOL_PARAMETERS });
  });

  it('Anthropic 裸形状缺 input_schema 时补默认值', () => {
    const out = ensureToolParameters([
      { name: 'cron_list', description: 'd' },
    ] as any);
    expect(out[0].input_schema).toEqual({ ...DEFAULT_TOOL_PARAMETERS });
  });

  it('非 function 内置工具原样保留', () => {
    const builtin = { type: 'web_search', external_web_access: false };
    const out = ensureToolParameters([builtin] as any);
    expect(out[0]).toBe(builtin);
  });

  it('非数组输入直接返回', () => {
    expect(ensureToolParameters(undefined)).toBeUndefined();
  });

  it('每次补的默认值是独立对象', () => {
    const out = ensureToolParameters([
      { type: 'function', function: { name: 'a' } },
      { type: 'function', function: { name: 'b' } },
    ] as any);
    expect(out[0].function.parameters).not.toBe(out[1].function.parameters);
  });
});
