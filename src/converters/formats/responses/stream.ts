// src/converters/formats/responses/stream.ts
import type { StreamConverter } from '../../format-adapter.js';
import type { ChatStreamChunk } from '../../canonical/types.js';

function stripSseField(line: string, field: string): string | null {
  const prefix = `${field}:`;
  if (!line.startsWith(prefix)) return null;
  return line.slice(prefix.length).trim();
}

function takeSseBlocks(buffer: string): string[] {
  const parts = buffer.split('\n\n');
  return parts.slice(0, -1);
}

function sanitizeReadArguments(name: string, raw: string): string {
  if (name !== 'Read' || raw === '') return raw;
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object' && obj.pages === '') delete obj.pages;
    return JSON.stringify(obj);
  } catch {
    return raw;
  }
}

function mapResponsesStopReason(status: string | undefined, hasToolUse: boolean, incompleteReason: string | undefined): string {
  if (hasToolUse && status === 'completed') return 'tool_calls';
  if (status === 'incomplete') {
    if (incompleteReason === 'max_output_tokens') return 'length';
    return 'stop';
  }
  return hasToolUse ? 'tool_calls' : 'stop';
}

/** 上游 Responses 命名事件 SSE -> canonical ChatStreamChunk[]（有状态） */
export class ResponsesUpstreamStream implements StreamConverter {
  private messageId = `resp_${Date.now()}`;
  private model = '';
  private hasToolUse = false;
  private nextContentIndex = 0;
  private indexByKey = new Map<string, number>();
  private openIndices = new Set<number>();
  private fallbackOpenIndex: number | null = null;
  private currentTextIndex: number | null = null;
  private toolIndexByItemId = new Map<string, number>();
  private toolNameByIndex = new Map<number, string>();
  private toolArgsByIndex = new Map<number, string>();
  private lastToolIndex: number | null = null;
  private created = Math.floor(Date.now() / 1000);
  private buffer = '';

  transform(raw: string): ChatStreamChunk[] {
    this.buffer += raw;
    const blocks = takeSseBlocks(this.buffer);
    if (blocks.length) {
      const last = this.buffer.lastIndexOf('\n\n');
      this.buffer = this.buffer.slice(last + 2);
    }
    const out: ChatStreamChunk[] = [];
    for (const block of blocks) {
      if (!block.trim()) continue;
      let eventType: string | undefined;
      const dataParts: string[] = [];
      for (const line of block.split('\n')) {
        const e = stripSseField(line, 'event');
        if (e !== null) eventType = e;
        const d = stripSseField(line, 'data');
        if (d !== null) dataParts.push(d);
      }
      if (!dataParts.length) continue;
      let data: any;
      try { data = JSON.parse(dataParts.join('\n')); } catch { continue; }

      const respObj = data.response ?? data;
      const ev = eventType ?? '';
      const cid = () => `chatcmpl_${this.messageId}`;

      switch (ev) {
        case 'response.created': {
          if (respObj.id) this.messageId = respObj.id;
          if (respObj.model) this.model = respObj.model;
          out.push({
            id: cid(), object: 'chat.completion.chunk', created: this.created, model: this.model,
            choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
            usage: respObj.usage ? { prompt_tokens: respObj.usage.input_tokens ?? 0, completion_tokens: 0 } : undefined,
          });
          break;
        }
        case 'response.content_part.added': {
          const part = data.part;
          if (part && (part.type === 'output_text' || part.type === 'refusal')) {
            const idx = this.currentTextIndex ?? this.assignTextIndex(data);
            this.currentTextIndex = idx;
            if (!this.openIndices.has(idx)) {
              this.openIndices.add(idx);
              out.push({ id: cid(), object: 'chat.completion.chunk', created: this.created, model: this.model, choices: [{ index: 0, delta: { content: '' }, finish_reason: null }] });
            }
          }
          break;
        }
        case 'response.output_text.delta':
        case 'response.refusal.delta': {
          const delta = data.delta;
          if (!delta) break;
          const idx = this.currentTextIndex ?? this.assignTextIndex(data);
          this.currentTextIndex = idx;
          if (!this.openIndices.has(idx)) {
            this.openIndices.add(idx);
            out.push({ id: cid(), object: 'chat.completion.chunk', created: this.created, model: this.model, choices: [{ index: 0, delta: { content: '' }, finish_reason: null }] });
          }
          out.push({ id: cid(), object: 'chat.completion.chunk', created: this.created, model: this.model, choices: [{ index: 0, delta: { content: delta }, finish_reason: null }] });
          break;
        }
        case 'response.output_item.added': {
          const item = data.item;
          if (item && item.type === 'function_call') {
            this.hasToolUse = true;
            if (this.currentTextIndex !== null) {
              const idx = this.currentTextIndex; this.currentTextIndex = null;
              if (this.openIndices.delete(idx)) out.push({ id: cid(), object: 'chat.completion.chunk', created: this.created, model: this.model, choices: [{ index: 0, delta: {}, finish_reason: null }] });
              if (this.fallbackOpenIndex === idx) this.fallbackOpenIndex = null;
            }
            const key = item.id ? `tool:${item.id}` : (data.item_id ? `tool:${data.item_id}` : `tool:out:${data.output_index ?? this.nextContentIndex}`);
            let idx = this.indexByKey.get(key) ?? this.nextContentIndex++;
            this.indexByKey.set(key, idx);
            if (item.id) this.toolIndexByItemId.set(item.id, idx);
            this.toolNameByIndex.set(idx, item.name ?? '');
            this.lastToolIndex = idx;
            if (!this.openIndices.has(idx)) {
              this.openIndices.add(idx);
              out.push({
                id: cid(), object: 'chat.completion.chunk', created: this.created, model: this.model,
                choices: [{ index: 0, delta: { tool_calls: [{ index: idx, id: item.call_id ?? '', type: 'function', function: { name: item.name ?? '', arguments: '' } }] }, finish_reason: null }],
              });
            }
          }
          break;
        }
        case 'response.function_call_arguments.delta': {
          const delta = data.delta;
          if (!delta) break;
          const itemId = data.item_id;
          let idx = (itemId && this.toolIndexByItemId.get(itemId)) ?? this.lastToolIndex ?? this.nextContentIndex++;
          if (!this.openIndices.has(idx)) {
            this.openIndices.add(idx);
            out.push({
              id: cid(), object: 'chat.completion.chunk', created: this.created, model: this.model,
              choices: [{ index: 0, delta: { tool_calls: [{ index: idx, id: data.call_id ?? itemId ?? '', type: 'function', function: { name: data.name ?? this.toolNameByIndex.get(idx) ?? '', arguments: '' } }] }, finish_reason: null }],
            });
          }
          if (this.toolNameByIndex.get(idx) === 'Read') {
            this.toolArgsByIndex.set(idx, (this.toolArgsByIndex.get(idx) ?? '') + delta);
            break;
          }
            out.push({
              id: cid(), object: 'chat.completion.chunk', created: this.created, model: this.model,
              choices: [{ index: 0, delta: { tool_calls: [{ index: idx, type: 'function', function: { arguments: delta } }] }, finish_reason: null }],
            });
          break;
        }
        case 'response.function_call_arguments.done': {
          const itemId = data.item_id;
          let idx = (itemId && this.toolIndexByItemId.get(itemId)) ?? this.lastToolIndex;
          if (idx === undefined) break;
          if (this.toolNameByIndex.get(idx) === 'Read') {
            const raw = data.arguments ?? this.toolArgsByIndex.get(idx) ?? '';
            const sanitized = sanitizeReadArguments('Read', raw);
            if (sanitized) out.push({ id: cid(), object: 'chat.completion.chunk', created: this.created, model: this.model, choices: [{ index: 0, delta: { tool_calls: [{ index: idx, type: 'function', function: { arguments: sanitized } }] }, finish_reason: null }] });
          }
          this.openIndices.delete(idx);
          this.toolIndexByItemId.delete(itemId ?? '');
          this.toolNameByIndex.delete(idx);
          this.toolArgsByIndex.delete(idx);
          break;
        }
        case 'response.reasoning.delta': {
          const delta = data.delta ?? data.text;
          if (!delta) break;
          if (this.currentTextIndex !== null) {
            const idx = this.currentTextIndex; this.currentTextIndex = null;
            if (this.openIndices.delete(idx)) out.push({ id: cid(), object: 'chat.completion.chunk', created: this.created, model: this.model, choices: [{ index: 0, delta: {}, finish_reason: null }] });
            if (this.fallbackOpenIndex === idx) this.fallbackOpenIndex = null;
          }
          const idx = this.assignTextIndex(data);
          if (!this.openIndices.has(idx)) {
            this.openIndices.add(idx);
            out.push({ id: cid(), object: 'chat.completion.chunk', created: this.created, model: this.model, choices: [{ index: 0, delta: { reasoning_content: '' }, finish_reason: null }] });
          }
          out.push({ id: cid(), object: 'chat.completion.chunk', created: this.created, model: this.model, choices: [{ index: 0, delta: { reasoning_content: delta }, finish_reason: null }] });
          break;
        }
        case 'response.completed': {
          const stopReason = mapResponsesStopReason(respObj.status, this.hasToolUse, respObj.incomplete_details?.reason);
          for (const idx of [...this.openIndices].sort((a, b) => a - b)) {
            this.openIndices.delete(idx);
            out.push({ id: cid(), object: 'chat.completion.chunk', created: this.created, model: this.model, choices: [{ index: 0, delta: {}, finish_reason: null }] });
          }
          this.fallbackOpenIndex = null;
          const usage = respObj.usage ? { prompt_tokens: respObj.usage.input_tokens ?? 0, completion_tokens: respObj.usage.output_tokens ?? 0, total_tokens: (respObj.usage.input_tokens ?? 0) + (respObj.usage.output_tokens ?? 0) } : undefined;
          out.push({ id: cid(), object: 'chat.completion.chunk', created: this.created, model: this.model, choices: [{ index: 0, delta: {}, finish_reason: stopReason }], usage });
          break;
        }
        default:
          break;
      }
    }
    return out;
  }

  flush(): ChatStreamChunk[] { return []; }

  private assignTextIndex(data: any): number {
    const key = this.contentPartKey(data);
    if (key) {
      const existing = this.indexByKey.get(key);
      if (existing !== undefined) return existing;
      const assigned = this.nextContentIndex++;
      this.indexByKey.set(key, assigned);
      return assigned;
    }
    if (this.fallbackOpenIndex !== null) return this.fallbackOpenIndex;
    const assigned = this.nextContentIndex++;
    this.fallbackOpenIndex = assigned;
    return assigned;
  }

  private contentPartKey(data: any): string | null {
    if (data.item_id && data.content_index !== undefined) return `part:${data.item_id}:${data.content_index}`;
    if (data.output_index !== undefined && data.content_index !== undefined) return `part:out:${data.output_index}:${data.content_index}`;
    return null;
  }
}

/** canonical ChatStreamChunk[] -> 客户端 Responses 命名事件 SSE（有状态） */
export class ResponsesDownstreamStream implements StreamConverter {
  private created = Math.floor(Date.now() / 1000);
  private buffer = '';
  transform(chunk: ChatStreamChunk): string[] {
    const out: string[] = [];
    const choice = chunk.choices?.[0];
    const delta = choice?.delta;
    const cid = () => `resp_${Date.now()}`;
    if (delta?.role) {
      out.push(`event: response.created\ndata: ${JSON.stringify({ type: 'response.created', response: { id: chunk.id, model: chunk.model, status: 'in_progress', output: [] } })}\n\n`);
    }
    if (delta?.reasoning_content || delta?.reasoning) {
      const t = delta.reasoning_content ?? delta.reasoning ?? '';
      out.push(`event: response.reasoning.delta\ndata: ${JSON.stringify({ type: 'response.reasoning.delta', delta: t })}\n\n`);
    }
    if (delta?.content) {
      out.push(`event: response.output_text.delta\ndata: ${JSON.stringify({ type: 'response.output_text.delta', delta: delta.content })}\n\n`);
    }
    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        if (tc.id || tc.function?.name) {
          out.push(`event: response.output_item.added\ndata: ${JSON.stringify({ type: 'response.output_item.added', item: { type: 'function_call', call_id: tc.id, name: tc.function?.name } })}\n\n`);
        }
        if (tc.function?.arguments) {
          out.push(`event: response.function_call_arguments.delta\ndata: ${JSON.stringify({ type: 'response.function_call_arguments.delta', delta: tc.function.arguments })}\n\n`);
          out.push(`event: response.function_call_arguments.done\ndata: ${JSON.stringify({ type: 'response.function_call_arguments.done' })}\n\n`);
        }
      }
    }
    if (choice?.finish_reason) {
      out.push(`event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { id: chunk.id, model: chunk.model, status: 'completed', usage: chunk.usage ?? {} } })}\n\n`);
    }
    return out;
  }
  flush(): string[] { return []; }
}
