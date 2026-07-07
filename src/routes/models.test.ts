import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { buildModelsList, createModelsRoute } from './models.js';
import type { ProxyConfig } from '../config.js';

function makeConfig(): ProxyConfig {
  return {
    models: [
      { customModel: 'gpt-4', realModel: 'gpt-4', apiKey: 'sk', baseUrl: 'https://api.openai.com', provider: 'openai', maxContextLength: 128000 },
      { customModel: 'legacy', realModel: 'legacy', apiKey: 'sk', baseUrl: 'https://api.openai.com', provider: 'openai', hidden: true },
      { customModel: 'no-max', realModel: 'nm', apiKey: 'sk', baseUrl: 'https://api.openai.com', provider: 'openai' }
    ],
    modelGroups: [
      { name: 'pool-a', models: ['gpt-4', 'legacy'] }
    ]
  };
}

describe('buildModelsList', () => {
  it('返回标准 list 外壳', () => {
    const list = buildModelsList(makeConfig());
    expect(list.object).toBe('list');
    expect(list.has_more).toBe(false);
    expect(Array.isArray(list.data)).toBe(true);
  });

  it('模型条目字段映射正确', () => {
    const list = buildModelsList(makeConfig());
    const gpt4 = list.data.find(d => d.id === 'gpt-4')!;
    expect(gpt4.object).toBe('model');
    expect(gpt4.max_context_length).toBe(128000);
    expect(gpt4.status).toBe('active');
    expect(gpt4.owned_by).toBe('llmgateway-model');
    expect(typeof gpt4.created).toBe('number');
  });

  it('hidden 模型 status 为 deprecated', () => {
    const list = buildModelsList(makeConfig());
    const legacy = list.data.find(d => d.id === 'legacy')!;
    expect(legacy.status).toBe('deprecated');
  });

  it('未配置 maxContextLength 时使用默认值 200000', () => {
    const list = buildModelsList(makeConfig());
    const noMax = list.data.find(d => d.id === 'no-max')!;
    expect(noMax.max_context_length).toBe(200000);
  });

  it('模型组作为条目返回，owned_by 为 llmgateway-group，取第一个模型的上下文长度', () => {
    const list = buildModelsList(makeConfig());
    const group = list.data.find(d => d.id === 'pool-a')!;
    expect(group.owned_by).toBe('llmgateway-group');
    expect(group.max_context_length).toBe(128000);
    expect(group.status).toBe('active');
  });

  it('data 顺序：先模型后组', () => {
    const list = buildModelsList(makeConfig());
    expect(list.data[list.data.length - 1].id).toBe('pool-a');
  });

  it('无 modelGroups 时不应报错', () => {
    const cfg = makeConfig();
    delete (cfg as any).modelGroups;
    const list = buildModelsList(cfg);
    expect(list.data.every(d => d.owned_by === 'llmgateway-model')).toBe(true);
  });
});

describe('createModelsRoute', () => {
  function buildApp(): Hono {
    const cfg = makeConfig();
    const app = new Hono();
    app.route('', createModelsRoute(() => cfg));
    return app;
  }

  it('GET /v1/models 返回 200 和标准结构', async () => {
    const res = await buildApp().request('/v1/models');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.object).toBe('list');
    expect(body.data.length).toBe(4);
  });

  it('GET /models 返回与 /v1/models 相同结构', async () => {
    const res = await buildApp().request('/models');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.object).toBe('list');
    expect(body.data.length).toBe(4);
  });
});
