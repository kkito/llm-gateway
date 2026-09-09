import { describe, it, expect } from 'vitest';
import { convertOpenAIRequestToAnthropic } from '../../src/converters/formats/anthropic/openai-to-anthropic.js';
import { convertAnthropicRequestToOpenAI } from '../../src/converters/formats/anthropic/anthropic-to-openai.js';
import { responsesToChatRequest, chatToResponsesRequest } from '../../src/converters/formats/responses/request.js';

describe('multimodal passthrough (image/audio/file)', () => {
  it('chat input_audio -> anthropic document(audio/*)', async () => {
    const r = await convertOpenAIRequestToAnthropic({
      model: 'm',
      messages: [{
        role: 'user',
        content: [{ type: 'input_audio', input_audio: { data: 'AAA', format: 'mp3' } }],
      }],
    } as any);
    expect(r.messages[0].content).toEqual([{
      type: 'document',
      source: { type: 'base64', media_type: 'audio/mp3', data: 'AAA' },
    }]);
  });

  it('chat file(file_data) -> anthropic document', async () => {
    const r = await convertOpenAIRequestToAnthropic({
      model: 'm',
      messages: [{
        role: 'user',
        content: [{ type: 'file', file: { filename: 'a.pdf', file_data: 'data:application/pdf;base64,AAA' } }],
      }],
    } as any);
    expect(r.messages[0].content).toEqual([{
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: 'AAA' },
    }]);
  });

  it('anthropic document(audio/*) -> chat input_audio', () => {
    const r = convertAnthropicRequestToOpenAI({
      model: 'm',
      max_tokens: 10,
      messages: [{
        role: 'user',
        content: [{ type: 'document', source: { type: 'base64', media_type: 'audio/wav', data: 'BBB' } }],
      }],
    } as any);
    expect(r.messages[0].content).toEqual([
      { type: 'input_audio', input_audio: { data: 'BBB', format: 'wav' } },
    ]);
  });

  it('anthropic document(pdf) -> chat file(file_data)', () => {
    const r = convertAnthropicRequestToOpenAI({
      model: 'm',
      max_tokens: 10,
      messages: [{
        role: 'user',
        content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'CCC' } }],
      }],
    } as any);
    expect(r.messages[0].content).toEqual([
      { type: 'file', file: { file_data: 'data:application/pdf;base64,CCC' } },
    ]);
  });

  it('responses input_audio/input_file -> chat 保留，不再 join 成纯文本', () => {
    const chat = responsesToChatRequest({
      model: 'm',
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: 'hi ' },
          { type: 'input_audio', input_audio: { data: 'AAA', format: 'mp3' } },
          { type: 'input_file', filename: 'a.pdf', file_data: 'data:application/pdf;base64,AAA' },
        ],
      }],
    });
    expect(chat.messages[0].content).toEqual([
      { type: 'text', text: 'hi ' },
      { type: 'input_audio', input_audio: { data: 'AAA', format: 'mp3' } },
      { type: 'file', file: { filename: 'a.pdf', file_data: 'data:application/pdf;base64,AAA', file_id: undefined } },
    ]);
  });

  it('chat 多模态 -> responses input_image/input_audio/input_file', () => {
    const r = chatToResponsesRequest({
      model: 'm',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'see' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
          { type: 'input_audio', input_audio: { data: 'BBB', format: 'wav' } },
          { type: 'file', file: { filename: 'a.pdf', file_data: 'data:application/pdf;base64,CCC' } },
        ],
      }],
    } as any);
    expect(r.input[0].content).toEqual([
      { type: 'input_text', text: 'see' },
      { type: 'input_image', image_url: 'data:image/png;base64,AAA' },
      { type: 'input_audio', input_audio: { data: 'BBB', format: 'wav' } },
      { type: 'input_file', filename: 'a.pdf', file_data: 'data:application/pdf;base64,CCC' },
    ]);
  });

  it('纯文本 responses 往返仍退化为字符串（兼容老行为）', () => {
    const chat = responsesToChatRequest({ model: 'm', input: [{ role: 'user', content: 'hi' }] });
    expect(chat.messages[0].content).toBe('hi');
    const back = chatToResponsesRequest(chat);
    expect(back.input[0].content).toBe('hi');
  });
});
