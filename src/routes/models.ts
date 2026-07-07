import { Hono } from 'hono';
import type { ProxyConfig, ProviderConfig, ModelGroup } from '../config.js';

export interface OpenAIModelObject {
  id: string;
  object: 'model';
  created: number;
  max_context_length: number;
  status: 'active' | 'deprecated';
  owned_by: string;
}

export interface OpenAIModelsList {
  object: 'list';
  data: OpenAIModelObject[];
  has_more: boolean;
}

function toModelEntry(p: ProviderConfig, created: number): OpenAIModelObject {
  return {
    id: p.customModel,
    object: 'model',
    created,
    max_context_length: p.maxContextLength ?? 200000,
    status: p.hidden ? 'deprecated' : 'active',
    owned_by: 'llmgateway-model'
  };
}

function toGroupEntry(
  group: ModelGroup,
  models: ProviderConfig[],
  created: number
): OpenAIModelObject {
  const firstModelName = group.models[0];
  const firstModel = models.find(m => m.customModel === firstModelName);
  const maxContextLength = firstModel?.maxContextLength ?? 200000;
  return {
    id: group.name,
    object: 'model',
    created,
    max_context_length: maxContextLength,
    status: 'active',
    owned_by: 'llmgateway-group'
  };
}

export function buildModelsList(config: ProxyConfig): OpenAIModelsList {
  const created = Math.floor(Date.now() / 1000);
  const data: OpenAIModelObject[] = [];

  for (const model of config.models) {
    data.push(toModelEntry(model, created));
  }

  for (const group of config.modelGroups ?? []) {
    data.push(toGroupEntry(group, config.models, created));
  }

  return {
    object: 'list',
    data,
    has_more: false
  };
}

export function createModelsRoute(config: ProxyConfig | (() => ProxyConfig)) {
  const router = new Hono();
  const handler = (c: any) => {
    const currentConfig = typeof config === 'function' ? config() : config;
    return c.json(buildModelsList(currentConfig));
  };
  router.get('/models', handler);
  router.get('/v1/models', handler);
  return router;
}
