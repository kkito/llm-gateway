import { describe, it, expect } from 'vitest';
import { ResponsesUpstreamStream, ResponsesDownstreamStream } from '../../../src/converters/formats/responses/stream.js';
import type { ChatStreamChunk } from '../../../src/converters/canonical/types.js';

function feed(stream: any, input: string): string {
  return stream.transform(input).map((c: any) => JSON.stringify(c)).join('\n');
}

function feedDownstream(chunks: ChatStreamChunk[]): any[] {
  const s = new ResponsesDownstreamStream();
  return chunks.flatMap((c) => s.transform(c).map((line: string) => {
    const m = line.match(/^data: (.*)$/m);
    return m ? JSON.parse(m[1]) : null;
  })).filter(Boolean);
}

describe('responses upstream stream', () => {
  it('function_call 流式映射为 tool_calls', () => {
    const input = [
      'event: response.created',
      'data: {"type":"response.created","response":{"id":"resp_1","model":"gpt-4o","usage":{"input_tokens":12,"output_tokens":0}}}',
      '',
      'event: response.output_item.added',
      'data: {"type":"response.output_item.added","item":{"type":"function_call","call_id":"call_1","name":"get_weather"}}',
      '',
      'event: response.function_call_arguments.delta',
      'data: {"type":"response.function_call_arguments.delta","delta":"{\\"city\\":\\"Tokyo\\"}"}',
      '',
      'event: response.function_call_arguments.done',
      'data: {"type":"response.function_call_arguments.done"}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":12,"output_tokens":3}}}',
      '',
    ].join('\n');
    const s = new ResponsesUpstreamStream();
    const merged = feed(s, input);
    expect(merged).toContain('"role":"assistant"');
    expect(merged).toContain('"name":"get_weather"');
    expect(merged).toContain('"arguments":"{\\"city\\":\\"Tokyo\\"}"');
  });

  it('Read 工具空 pages 参数被清洗', () => {
    const input = [
      'event: response.created',
      'data: {"type":"response.created","response":{"id":"resp_read","model":"gpt-5.5"}}',
      '',
      'event: response.output_item.added',
      'data: {"type":"response.output_item.added","item":{"id":"fc_read","type":"function_call","call_id":"call_read","name":"Read"}}',
      '',
      'event: response.function_call_arguments.delta',
      'data: {"type":"response.function_call_arguments.delta","item_id":"fc_read","delta":"{\\"file_path\\":\\"/tmp/demo.py\\",\\"limit\\":2000,\\"offset\\":0,\\"pages\\":\\"\\"}"}',
      '',
      'event: response.function_call_arguments.done',
      'data: {"type":"response.function_call_arguments.done","item_id":"fc_read","arguments":"{\\"file_path\\":\\"/tmp/demo.py\\",\\"limit\\":2000,\\"offset\\":0,\\"pages\\":\\"\\"}"}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed","response":{"status":"completed"}}',
      '',
    ].join('\n');
    const s = new ResponsesUpstreamStream();
    const merged = feed(s, input);
    expect(merged).toContain('"name":"Read"');
    expect(merged).toContain('"arguments":"{\\"file_path\\":\\"/tmp/demo.py\\",\\"limit\\":2000,\\"offset\\":0}"');
    expect(merged).not.toContain('"pages"');
  });
});

describe('responses upstream stream usage', () => {
  it('response.completed 保留 input_tokens_details.cached_tokens', () => {
    const input = [
      'event: response.completed',
      'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":26059,"output_tokens":409,"total_tokens":26468,"input_tokens_details":{"cached_tokens":14577},"output_tokens_details":{"reasoning_tokens":363}}}}',
      '',
    ].join('\n') + '\n\n';
    const s = new ResponsesUpstreamStream();
    const chunks = s.transform(input);
    expect(chunks.length).toBe(1);
    expect(chunks[0].usage?.prompt_tokens).toBe(26059);
    expect((chunks[0].usage as any)?.prompt_tokens_details?.cached_tokens).toBe(14577);
  });

  it('response.completed 透传 output_tokens_details.reasoning_tokens（passthrough 链路不断流）', () => {
    const input = [
      'event: response.completed',
      'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":3719,"output_tokens":416,"total_tokens":4135,"input_tokens_details":{"cached_tokens":0},"output_tokens_details":{"reasoning_tokens":402}}}}',
      '',
    ].join('\n') + '\n\n';
    const s = new ResponsesUpstreamStream();
    const chunks = s.transform(input);
    expect(chunks.length).toBe(1);
    expect((chunks[0].usage as any)?.completion_tokens_details?.reasoning_tokens).toBe(402);

    const events = feedDownstream(chunks);
    const completed = events.find((e) => e.type === 'response.completed');
    expect(completed.response.usage.output_tokens_details).toMatchObject({ reasoning_tokens: 402 });
  });
});

describe('responses downstream stream (chat -> responses)', () => {
  it('reasoning + text 流式带完整 item/part 层次结构（对齐 cc-switch）', () => {
    const chunks: ChatStreamChunk[] = [
      { id: 'chatcmpl_abc', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] },
      { id: 'chatcmpl_abc', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: { reasoning_content: 'Let' }, finish_reason: null }] },
      { id: 'chatcmpl_abc', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: { content: 'Hi' }, finish_reason: null }] },
      { id: 'chatcmpl_abc', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } },
    ];

    const events = feedDownstream(chunks);
    const types = events.map((e) => e.type);

    // 顺序：created -> reasoning item 建立 -> reasoning delta -> text item + part 建立 -> text delta -> done -> completed
    expect(types[0]).toBe('response.created');
    expect(types).toContain('response.output_item.added');
    expect(types).toContain('response.reasoning.delta');
    expect(types).toContain('response.content_part.added');
    expect(types).toContain('response.output_text.delta');
    expect(types).toContain('response.output_text.done');
    expect(types).toContain('response.completed');

    // reasoning delta 必须带 item_id / output_index / content_index
    const rd = events.find((e) => e.type === 'response.reasoning.delta');
    expect(rd.item_id).toBeTruthy();
    expect(rd.output_index).toBe(0);
    expect(rd.content_index).toBe(0);
    expect(rd.delta).toBe('Let');

    // text delta 必须带 item_id / output_index / content_index
    const td = events.find((e) => e.type === 'response.output_text.delta');
    expect(td.item_id).toBeTruthy();
    expect(td.output_index).toBe(1);
    expect(td.content_index).toBe(0);
    expect(td.delta).toBe('Hi');

    // item 建立事件带 id 与正确 type
    const items = events.filter((e) => e.type === 'response.output_item.added').map((e) => e.item);
    expect(items.some((i) => i.type === 'reasoning' && i.id === rd.item_id)).toBe(true);
    expect(items.some((i) => i.type === 'message' && i.id === td.item_id)).toBe(true);

    const completed = events.find((e) => e.type === 'response.completed');
    expect(completed.response.status).toBe('completed');
    // usage 恒带 details（对齐 cc-switch）：无上游 details 时补 0，避免前端严格解析断流
    expect(completed.response.usage).toMatchObject({
      input_tokens: 1, output_tokens: 2, total_tokens: 3,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    });
  });

  it('下游 usage 透传 completion_tokens_details 并补齐 reasoning_tokens', () => {
    const chunks: ChatStreamChunk[] = [
      { id: 'chatcmpl_x', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] },
      { id: 'chatcmpl_x', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 6, total_tokens: 10, prompt_tokens_details: { cached_tokens: 2 }, completion_tokens_details: { accepted_prediction_tokens: 5 } as any } },
    ];
    const events = feedDownstream(chunks);
    const completed = events.find((e) => e.type === 'response.completed');
    expect(completed.response.usage.output_tokens_details).toMatchObject({ accepted_prediction_tokens: 5, reasoning_tokens: 0 });
    expect(completed.response.usage.input_tokens_details).toMatchObject({ cached_tokens: 2 });
  });
});

describe('responses downstream stream — tool call 完整生命周期（P0）', () => {
  function parse(lines: string[]): any[] {
    return lines.map((line) => {
      const m = line.match(/^data: (.*)$/m);
      return m ? JSON.parse(m[1]) : null;
    }).filter(Boolean);
  }
  function run(chunks: ChatStreamChunk[]): any[] {
    const s = new ResponsesDownstreamStream();
    const events = chunks.flatMap((c) => parse(s.transform(c)));
    events.push(...parse(s.flush()));
    return events;
  }
  function chunk(delta: any, finish_reason: any = null, usage?: any): ChatStreamChunk {
    return {
      id: 'chatcmpl_tool', object: 'chat.completion.chunk', created: 1783650022, model: 'm',
      choices: [{ index: 0, delta, finish_reason }],
      ...(usage ? { usage } : {}),
    } as ChatStreamChunk;
  }

  it('function_call 有完整 added/delta/done/item.done，并进入 completed.output', () => {
    const events = run([
      chunk({ role: 'assistant' }),
      chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '' } }] }),
      chunk({ tool_calls: [{ index: 0, type: 'function', function: { arguments: '{"city":' } }] }),
      chunk({ tool_calls: [{ index: 0, type: 'function', function: { arguments: '"Tokyo"}' } }] }),
      chunk({}, 'tool_calls'),
      { id: 'chatcmpl_tool', object: 'chat.completion.chunk', created: 1783650022, model: 'm', choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } } as any,
    ]);
    const types = events.map((e) => e.type);

    expect(types).toContain('response.output_item.added');
    expect(types).toContain('response.function_call_arguments.delta');
    expect(types).toContain('response.function_call_arguments.done');
    expect(types).toContain('response.output_item.done');

    // done 在最后一个 delta 之后、completed 之前，且只出现一次
    const doneIdx = types.indexOf('response.function_call_arguments.done');
    const lastDeltaIdx = types.lastIndexOf('response.function_call_arguments.delta');
    const completedIdx = types.indexOf('response.completed');
    expect(doneIdx).toBeGreaterThan(lastDeltaIdx);
    expect(doneIdx).toBeLessThan(completedIdx);

    // arguments.done 带完整参数（官方字段）
    const argsDone = events.find((e) => e.type === 'response.function_call_arguments.done');
    expect(argsDone.arguments).toBe('{"city":"Tokyo"}');

    // output_item.done 的 function_call item 完整
    const itemDone = events.find((e) => e.type === 'response.output_item.done' && e.item.type === 'function_call');
    expect(itemDone.item).toMatchObject({ type: 'function_call', status: 'completed', call_id: 'call_1', name: 'get_weather', arguments: '{"city":"Tokyo"}' });

    // completed.output 含 function_call（客户端据此驱动工具循环）
    const completed = events.find((e) => e.type === 'response.completed');
    expect(completed.response.output).toHaveLength(1);
    expect(completed.response.output[0]).toMatchObject({ type: 'function_call', status: 'completed', call_id: 'call_1', name: 'get_weather', arguments: '{"city":"Tokyo"}' });

    // usage 取自后到的 usage chunk，不被 finalize 提前丢掉
    expect(completed.response.usage).toMatchObject({ input_tokens: 10, output_tokens: 5, total_tokens: 15 });
    expect(types[types.length - 1]).toBe('response.completed');
  });

  it('text + function_call：output_index 连续，completed 带 response 元字段', () => {
    const events = run([
      chunk({ role: 'assistant' }),
      chunk({ content: 'Sure' }),
      chunk({ tool_calls: [{ index: 0, id: 'call_9', type: 'function', function: { name: 'f', arguments: '{}' } }] }),
      chunk({}, 'tool_calls', { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }),
    ]);
    const dones = events.filter((e) => e.type === 'response.output_item.done');
    expect(dones.map((e) => e.output_index)).toEqual([0, 1]);

    const completed = events.find((e) => e.type === 'response.completed');
    expect(completed.response.output.map((i: any) => i.type)).toEqual(['message', 'function_call']);
    expect(completed.response.object).toBe('response');
    expect(completed.response.created_at).toBe(1783650022);
    expect(completed.response.error).toBeNull();
    expect(completed.response.incomplete_details).toBeNull();
    expect(completed.response.id.startsWith('resp_')).toBe(true);
  });

  it('finish_reason=length -> completed status incomplete + incomplete_details', () => {
    const events = run([
      chunk({ role: 'assistant' }),
      chunk({ content: 'partial' }),
      chunk({}, 'length', { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }),
    ]);
    const completed = events.find((e) => e.type === 'response.completed');
    expect(completed.response.status).toBe('incomplete');
    expect(completed.response.incomplete_details).toEqual({ reason: 'max_output_tokens' });
  });

  it('response.in_progress 在 created 之后发射', () => {
    const events = run([
      chunk({ role: 'assistant' }),
      chunk({ content: 'x' }),
      chunk({}, 'stop', { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }),
    ]);
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('response.created');
    expect(types[1]).toBe('response.in_progress');
  });

  it('无 usage chunk 时 flush 兜底 finalize，usage 补 0', () => {
    const events = run([
      chunk({ role: 'assistant' }),
      chunk({ content: 'x' }),
      chunk({}, 'stop'),
    ]);
    const completed = events.find((e) => e.type === 'response.completed');
    expect(completed).toBeTruthy();
    expect(completed.response.usage).toMatchObject({ input_tokens: 0, output_tokens: 0, total_tokens: 0 });
  });
});

describe('responses 端到端 SSE 转换（基于真实日志 efa5e4f2）', () => {
  // 上游 openai chat 原始 chunk（来自 raw_stream_response.log），保留关键 delta
  const rawChunks = [
    'data: {"id":"0ccbc45f-6b14-4ca8-bc01-367518e4f1f1","object":"chat.completion.chunk","created":1783650022,"model":"deepseek-v4-flash","choices":[{"index":0,"finish_reason":null,"delta":{"role":"assistant","content":null,"reasoning_content":""}}],"usage":null}',
    'data: {"id":"0ccbc45f-6b14-4ca8-bc01-367518e4f1f1","object":"chat.completion.chunk","created":1783650022,"model":"deepseek-v4-flash","choices":[{"index":0,"finish_reason":null,"delta":{"content":null,"reasoning_content":"The"}}],"usage":null}',
    'data: {"id":"0ccbc45f-6b14-4ca8-bc01-367518e4f1f1","object":"chat.completion.chunk","created":1783650022,"model":"deepseek-v4-flash","choices":[{"index":0,"finish_reason":null,"delta":{"content":null,"reasoning_content":" said"}}],"usage":null}',
    'data: {"id":"0ccbc45f-6b14-4ca8-bc01-367518e4f1f1","object":"chat.completion.chunk","created":1783650022,"model":"deepseek-v4-flash","choices":[{"index":0,"finish_reason":null,"delta":{"content":null,"reasoning_content":" \\"hello\\""}}],"usage":null}',
    'data: {"id":"0ccbc45f-6b14-4ca8-bc01-367518e4f1f1","object":"chat.completion.chunk","created":1783650022,"model":"deepseek-v4-flash","choices":[{"index":0,"finish_reason":null,"delta":{"content":"Hey","reasoning_content":null}}],"usage":null}',
    'data: {"id":"0ccbc45f-6b14-4ca8-bc01-367518e4f1f1","object":"chat.completion.chunk","created":1783650022,"model":"deepseek-v4-flash","choices":[{"index":0,"finish_reason":null,"delta":{"content":"!","reasoning_content":null}}],"usage":null}',
    'data: {"id":"0ccbc45f-6b14-4ca8-bc01-367518e4f1f1","object":"chat.completion.chunk","created":1783650022,"model":"deepseek-v4-flash","choices":[{"index":0,"finish_reason":null,"delta":{"content":" How can I help you today","reasoning_content":null}}],"usage":null}',
    'data: {"id":"0ccbc45f-6b14-4ca8-bc01-367518e4f1f1","object":"chat.completion.chunk","created":1783650022,"model":"deepseek-v4-flash","choices":[{"index":0,"finish_reason":null,"delta":{"content":"?","reasoning_content":null}}],"usage":null}',
    'data: {"id":"0ccbc45f-6b14-4ca8-bc01-367518e4f1f1","object":"chat.completion.chunk","created":1783650022,"model":"deepseek-v4-flash","choices":[{"index":0,"finish_reason":"stop","delta":{"content":"","reasoning_content":null}}],"usage":{"prompt_tokens":13604,"completion_tokens":35,"total_tokens":13639,"prompt_cache_hit_tokens":13568,"prompt_cache_miss_tokens":36,"prompt_tokens_details":{"cached_tokens":13568},"completion_tokens_details":{"reasoning_tokens":25}}}',
  ];

  function parseRaw(raw: string): ChatStreamChunk[] {
    // chat endpoint 上游直接返回 openai chat.completion.chunk（已是 canonical），按行解析 JSON
    return raw.split('\n\n').map((b) => b.trim()).filter(Boolean).map((b) => JSON.parse(b.replace(/^data: /, '')));
  }

  it('raw chat chunk -> 客户端 responses SSE 完整流程（带 reasoning + text + 非空 output）', () => {
    const canonical = parseRaw(rawChunks.join('\n\n'));
    // 上游转换产出 canonical chat chunk 流
    expect(canonical.some((c) => (c.choices?.[0]?.delta as any)?.reasoning_content)).toBe(true);
    expect(canonical.some((c) => (c.choices?.[0]?.delta as any)?.content === 'Hey')).toBe(true);
    const last = canonical[canonical.length - 1];
    expect(last.choices?.[0]?.finish_reason).toBe('stop');
    expect(last.usage?.total_tokens).toBe(13639);

    // 下游转换：canonical -> 客户端 Responses SSE
    const down = new ResponsesDownstreamStream();
    const events = canonical.flatMap((c) => down.transform(c).map((line: string) => {
      const m = line.match(/^data: (.*)$/m);
      return m ? JSON.parse(m[1]) : null;
    })).filter(Boolean);

    // 1) 事件层次顺序正确
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('response.created');
    expect(types).toContain('response.output_item.added');
    expect(types).toContain('response.reasoning.delta');
    expect(types).toContain('response.content_part.added');
    expect(types).toContain('response.output_text.delta');
    expect(types).toContain('response.output_text.done');
    expect(types).toContain('response.output_item.done');
    expect(types[types.length - 1]).toBe('response.completed');

    // 2) reasoning 先于 text delta
    const firstReasoning = events.findIndex((e) => e.type === 'response.reasoning.delta');
    const firstText = events.findIndex((e) => e.type === 'response.output_text.delta');
    expect(firstReasoning).toBeGreaterThanOrEqual(0);
    expect(firstText).toBeGreaterThan(firstReasoning);

    // 3) completed.output 必须非空，含 reasoning + message
    const completed = events[events.length - 1];
    const output = completed.response.output;
    expect(Array.isArray(output)).toBe(true);
    expect(output.length).toBe(2);
    expect(output[0].type).toBe('reasoning');
    expect(output[1].type).toBe('message');

    // 4) message item 带完整真实文本（非 ""
    const msg = output[1];
    expect(msg.content[0].text).toBe('Hey! How can I help you today?');
    expect(msg.status).toBe('completed');

    // 5) reasoning item 带真实 summary 文本
    expect(output[0].summary[0].text).toContain('said');

    // 6) output_text.done / content_part.done 也带真实文本
    const textDone = events.find((e) => e.type === 'response.output_text.done');
    expect(textDone.text).toBe('Hey! How can I help you today?');
    const partDone = events.find((e) => e.type === 'response.content_part.done');
    expect(partDone.part.text).toBe('Hey! How can I help you today?');

    // 7) usage 重映射为 Responses 格式（input_tokens/output_tokens），而非 chat 的 prompt_tokens/completion_tokens
    const usage = completed.response.usage;
    expect(usage.input_tokens).toBe(13604);
    expect(usage.output_tokens).toBe(35);
    expect(usage.total_tokens).toBe(13639);
    expect(usage.output_tokens_details?.reasoning_tokens).toBe(25);
    expect(usage).not.toHaveProperty('prompt_tokens');
    expect(usage).not.toHaveProperty('completion_tokens');
  });
});

