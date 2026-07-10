import { describe, it, expect } from 'vitest';
import { ResponsesUpstreamStream } from '../../../src/converters/formats/responses/stream.js';

function feed(stream: any, input: string): string {
  return stream.transform(input).map((c: any) => JSON.stringify(c)).join('\n');
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
