import { describe, it, expect } from 'vitest';
import { responsesToChatRequest, chatToResponsesRequest } from '../../../src/converters/formats/responses/request.js';

describe('responses request', () => {
  it('instructions -> system, input message -> user', () => {
    const r = {
      model: 'gpt-4o',
      instructions: 'sys',
      input: [{ role: 'user', content: 'hi' }],
      stream: true,
    };
    const chat = responsesToChatRequest(r);
    expect(chat.responseInstructions).toBe('sys');
    expect(chat.messages[0].role).toBe('system');
    expect(chat.messages[0].content).toBe('sys');
    expect(chat.messages[1].role).toBe('user');
    expect(chat.messages[1].content).toBe('hi');
    expect(chat.stream).toBe(true);
  });
  it('previous_response_id 保留到保真槽', () => {
    const r = { model: 'gpt-4o', previous_response_id: 'resp_1', input: 'hello' };
    const chat = responsesToChatRequest(r);
    expect(chat.previousResponseId).toBe('resp_1');
  });
  it('chat system+user -> instructions+input', () => {
    const chat = {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ],
      previousResponseId: 'resp_1',
    } as any;
    const r = chatToResponsesRequest(chat);
    expect(r.instructions).toBe('sys');
    expect(r.previous_response_id).toBe('resp_1');
    expect(Array.isArray(r.input)).toBe(true);
    expect(r.input[0].role).toBe('user');
    expect(r.input[0].content).toBe('hi');
  });

  it('扁平 tools -> chat function.name 保留', () => {
    const r = {
      model: 'gpt-4o',
      tools: [{ type: 'function', name: 'get_weather', description: 'd', parameters: { type: 'object' } }],
      input: 'hi',
    };
    const chat = responsesToChatRequest(r);
    expect(chat.tools?.[0].function.name).toBe('get_weather');
    expect(chat.tools?.[0].function.description).toBe('d');
  });

  it('嵌套 tools 也能解析出 function.name（保真对齐 SDK）', () => {
    const r = {
      model: 'gpt-4o',
      tools: [{ type: 'function', function: { name: 'get_weather', description: 'd', parameters: {} } }],
      input: 'hi',
    };
    const chat = responsesToChatRequest(r);
    expect(chat.tools?.[0].function.name).toBe('get_weather');
    expect(chat.tools?.[0].function.description).toBe('d');
  });

  it('非 function 工具（web_search/namespace）被丢弃，不生成缺 name 的畸形 tool', () => {
    const r = {
      model: 'gpt-4o',
      tools: [
        { type: 'function', name: 'exec_command', description: 'run', parameters: {} },
        { type: 'web_search', external_web_access: false },
        { type: 'namespace', name: 'multi_agent_v1' },
        { type: 'function', function: { name: 'get_weather' } },
      ],
      input: 'hi',
    };
    const chat = responsesToChatRequest(r);
    expect(chat.tools).toHaveLength(2);
    expect(chat.tools!.map((t) => t.function.name).sort()).toEqual(['exec_command', 'get_weather']);
    // 转发出去的所有 tool 都必须带 name
    for (const t of chat.tools!) {
      expect(t.function.name).toBeTruthy();
      expect(t.type).toBe('function');
    }
  });

  it('tool_choice 双向转换（带 tools 时保留）', () => {
    const r = {
      model: 'gpt-4o',
      input: 'hi',
      tools: [{ type: 'function', name: 'get_weather', description: 'd', parameters: {} }],
      tool_choice: { type: 'function', name: 'get_weather' },
    };
    const chat = responsesToChatRequest(r);
    expect(chat.tool_choice).toEqual({ type: 'function', function: { name: 'get_weather' } });

    const back = chatToResponsesRequest(chat);
    expect(back.tool_choice).toEqual({ type: 'function', name: 'get_weather' });
  });

  it('chat -> responses：tool_choice "required" 降级为 "auto"（opencode zen 只支持 auto）', () => {
    const chat = {
      model: 'muse-spark',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ type: 'function', function: { name: 'exec_command', description: 'run', parameters: {} } }],
      tool_choice: 'required',
    } as any;
    const r = chatToResponsesRequest(chat);
    expect(r.tool_choice).toBe('auto');
  });

  it('chat -> responses：无 tools 时丢弃 tool_choice，避免悬空', () => {
    const chat = {
      model: 'muse-spark',
      messages: [{ role: 'user', content: 'hi' }],
      tool_choice: 'required',
    } as any;
    const r = chatToResponsesRequest(chat);
    expect(r.tool_choice).toBeUndefined();
  });

  it('chat -> responses：tool_choice 指向不存在的函数名时降级为 "auto"', () => {
    const chat = {
      model: 'muse-spark',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ type: 'function', function: { name: 'exec_command', description: 'run', parameters: {} } }],
      tool_choice: { type: 'function', function: { name: 'gone' } },
    } as any;
    const r = chatToResponsesRequest(chat);
    expect(r.tool_choice).toBe('auto');
  });

  it('chat -> responses 工具补全 type:"function"', () => {
    const chat = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ type: 'function', function: { name: 'get_weather', description: 'd', parameters: {} } }],
    } as any;
    const r = chatToResponsesRequest(chat);
    expect(r.tools[0].type).toBe('function');
    expect(r.tools[0].name).toBe('get_weather');
  });

  it('chat -> responses：缺 parameters 的 function tool 补默认空 schema（Qwen deferred tool）', () => {
    const chat = {
      model: 'muse-spark',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ type: 'function', function: { name: 'cron_list', description: 'd' } }],
    } as any;
    const r = chatToResponsesRequest(chat);
    expect(r.tools[0].parameters).toEqual({ type: 'object', properties: {} });
  });

  it('responses -> chat：缺 parameters 的扁平 function tool 补默认空 schema', () => {
    const r = {
      model: 'gpt-4o',
      tools: [{ type: 'function', name: 'cron_list', description: 'd' }],
      input: 'hi',
    };
    const chat = responsesToChatRequest(r);
    expect(chat.tools?.[0].function.parameters).toEqual({ type: 'object', properties: {} });
  });
});

describe('responses request — 连续 function_call 合并与保真（P2）', () => {
  it('连续 function_call 合并为一个 assistant 消息（并行工具调用）', () => {
    const r = {
      model: 'm',
      input: [
        { type: 'function_call', call_id: 'c1', name: 'f1', arguments: '{}' },
        { type: 'function_call', call_id: 'c2', name: 'f2', arguments: '{"a":1}' },
        { type: 'function_call_output', call_id: 'c1', output: 'r1' },
        { type: 'function_call_output', call_id: 'c2', output: 'r2' },
      ],
    };
    const chat = responsesToChatRequest(r);
    expect(chat.messages).toHaveLength(3);
    expect(chat.messages[0].role).toBe('assistant');
    expect(chat.messages[0].tool_calls).toHaveLength(2);
    expect(chat.messages[1]).toMatchObject({ role: 'tool', tool_call_id: 'c1' });
    expect(chat.messages[2]).toMatchObject({ role: 'tool', tool_call_id: 'c2' });
  });

  it('function_call 携带的 reasoning_content 回传到 assistant 消息', () => {
    const r = {
      model: 'm',
      input: [
        { type: 'function_call', call_id: 'c1', name: 'f1', arguments: '{}', reasoning_content: 'think hard' },
        { type: 'function_call_output', call_id: 'c1', output: 'r1' },
      ],
    };
    const chat = responsesToChatRequest(r);
    expect(chat.messages[0].reasoning).toBe('think hard');
  });

  it('assistant(tool_calls) 与 tool 消息之间注入的 system 消息被前移', () => {
    const r = {
      model: 'm',
      input: [
        { role: 'user', content: 'go' },
        { type: 'function_call', call_id: 'c1', name: 'f1', arguments: '{}' },
        { type: 'message', role: 'system', content: 'approval notice' },
        { type: 'function_call_output', call_id: 'c1', output: 'r1' },
      ],
    };
    const chat = responsesToChatRequest(r);
    expect(chat.messages.map((m) => m.role)).toEqual(['user', 'system', 'assistant', 'tool']);
  });

  it('developer role 映射为 system（Codex 系统消息）', () => {
    const r = { model: 'm', input: [{ type: 'message', role: 'developer', content: 'sys' }] };
    const chat = responsesToChatRequest(r);
    expect(chat.messages[0].role).toBe('system');
  });

  it('top_p / parallel_tool_calls / text.format 透传', () => {
    const r = { model: 'm', input: 'hi', top_p: 0.5, parallel_tool_calls: true, text: { format: { type: 'json_object' } } };
    const chat = responsesToChatRequest(r);
    expect(chat.top_p).toBe(0.5);
    expect(chat.parallel_tool_calls).toBe(true);
    expect(chat.response_format).toEqual({ type: 'json_object' });
  });

  it('chat -> responses：response_format/top_p/parallel_tool_calls 反向映射', () => {
    const chat = {
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      response_format: { type: 'json_object' },
      top_p: 0.5,
      parallel_tool_calls: true,
    } as any;
    const r = chatToResponsesRequest(chat);
    expect(r.text).toEqual({ format: { type: 'json_object' } });
    expect(r.top_p).toBe(0.5);
    expect(r.parallel_tool_calls).toBe(true);
  });
});
