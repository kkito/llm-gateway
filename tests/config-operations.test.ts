import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadFullConfig, saveConfig, type ProxyConfig, type ProviderConfig } from '../src/config.js';
import {
  removeModelFromConfig,
  renameModelInConfig,
  removeModelGroupFromConfig,
} from '../src/config-operations.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync, unlinkSync } from 'fs';

function makeModel(customModel: string, realModel = 'gpt-4'): ProviderConfig {
  return {
    customModel,
    realModel,
    apiKey: 'sk-test',
    baseUrl: 'https://api.openai.com',
    provider: 'openai',
  };
}

function makeBaseConfig(): ProxyConfig {
  return {
    models: [
      makeModel('gpt-4', 'gpt-4'),
      makeModel('gpt-3.5', 'gpt-3.5-turbo'),
      makeModel('claude-3', 'claude-3-opus'),
    ],
    modelGroups: [
      { name: 'gpt-pool', models: ['gpt-4', 'gpt-3.5'], desc: 'GPT 模型池' },
      { name: 'mixed-pool', models: ['gpt-4', 'claude-3'], desc: '混合模型池' },
      { name: 'single-claude', models: ['claude-3'], desc: '单模型组' },
    ],
    userApiKeys: [
      { name: '单模型用户', apikey: 'sk-lg-single', allowedModels: ['gpt-4'] },
      { name: '多模型用户', apikey: 'sk-lg-multi', allowedModels: ['gpt-4', 'claude-3'] },
      { name: '无限用户', apikey: 'sk-lg-unlim' },
    ],
  };
}

describe('config-operations', () => {
  const tempConfigPath = join(tmpdir(), 'llm-gateway-test-config-ops.json');

  afterEach(() => {
    if (existsSync(tempConfigPath)) {
      unlinkSync(tempConfigPath);
    }
  });

  describe('removeModelFromConfig', () => {
    it('应该从 models 数组中移除指定模型', () => {
      const config = makeBaseConfig();
      const result = removeModelFromConfig(config, 'gpt-4');

      expect(result.models.find(m => m.customModel === 'gpt-4')).toBeUndefined();
      expect(result.models.find(m => m.customModel === 'gpt-3.5')).toBeDefined();
      expect(result.models.find(m => m.customModel === 'claude-3')).toBeDefined();
    });

    it('应该从所有 modelGroups.models 中移除该模型引用', () => {
      const config = makeBaseConfig();
      const result = removeModelFromConfig(config, 'gpt-4');

      const gptPool = result.modelGroups!.find(g => g.name === 'gpt-pool');
      expect(gptPool!.models).not.toContain('gpt-4');
      expect(gptPool!.models).toContain('gpt-3.5');

      const mixedPool = result.modelGroups!.find(g => g.name === 'mixed-pool');
      expect(mixedPool!.models).not.toContain('gpt-4');
      expect(mixedPool!.models).toContain('claude-3');
    });

    it('当 modelGroup 全部引用被清空时应该删除该组', () => {
      const config = makeBaseConfig();
      const result = removeModelFromConfig(config, 'claude-3');

      const singleGroup = result.modelGroups!.find(g => g.name === 'single-claude');
      expect(singleGroup).toBeUndefined();

      const mixedPool = result.modelGroups!.find(g => g.name === 'mixed-pool');
      expect(mixedPool).toBeDefined();
      expect(mixedPool!.models).toEqual(['gpt-4']);
    });

    it('应该从 userApiKeys.allowedModels 中移除该模型', () => {
      const config = makeBaseConfig();
      const result = removeModelFromConfig(config, 'gpt-4');

      const multiUser = result.userApiKeys!.find(u => u.name === '多模型用户');
      expect(multiUser!.allowedModels).toEqual(['claude-3']);
    });

    it('当 user 的 allowedModels 被清空时应该置为 undefined', () => {
      const config = makeBaseConfig();
      const result = removeModelFromConfig(config, 'gpt-4');

      const singleUser = result.userApiKeys!.find(u => u.name === '单模型用户');
      expect(singleUser!.allowedModels).toBeUndefined();
    });

    it('无 allowedModels 的 user 不应被影响', () => {
      const config = makeBaseConfig();
      const result = removeModelFromConfig(config, 'gpt-4');

      const unlimited = result.userApiKeys!.find(u => u.name === '无限用户');
      expect(unlimited).toBeDefined();
      expect(unlimited!.allowedModels).toBeUndefined();
    });

    it('不应该修改原始 config 对象（保持纯函数语义）', () => {
      const config = makeBaseConfig();
      const snapshot = JSON.stringify(config);
      removeModelFromConfig(config, 'gpt-4');

      expect(JSON.stringify(config)).toBe(snapshot);
    });

    it('不存在的模型应该抛错', () => {
      const config = makeBaseConfig();
      expect(() => removeModelFromConfig(config, 'nonexistent'))
        .toThrow('未找到模型：nonexistent');
    });

    it('modelGroups 缺失时不应该报错', () => {
      const config: ProxyConfig = {
        models: [makeModel('a'), makeModel('b')],
      };
      const result = removeModelFromConfig(config, 'a');

      expect(result.models).toHaveLength(1);
      expect(result.modelGroups).toBeUndefined();
    });

    it('userApiKeys 缺失时不应该报错', () => {
      const config: ProxyConfig = {
        models: [makeModel('a'), makeModel('b')],
      };
      const result = removeModelFromConfig(config, 'a');

      expect(result.models).toHaveLength(1);
      expect(result.userApiKeys).toBeUndefined();
    });

    it('保存到文件后重新加载应保持清理结果', () => {
      const config = makeBaseConfig();
      saveConfig(config, tempConfigPath);

      const loaded = loadFullConfig(tempConfigPath);
      const result = removeModelFromConfig(loaded, 'claude-3');
      saveConfig(result, tempConfigPath);

      const reloaded = loadFullConfig(tempConfigPath);
      expect(reloaded.models.find(m => m.customModel === 'claude-3')).toBeUndefined();
      expect(reloaded.modelGroups!.find(g => g.name === 'single-claude')).toBeUndefined();
    });
  });

  describe('renameModelInConfig', () => {
    it('应该更新所有 modelGroups.models 中的旧名引用为新名', () => {
      const config = makeBaseConfig();
      const result = renameModelInConfig(config, 'gpt-4', 'gpt-4-renamed');

      const gptPool = result.modelGroups!.find(g => g.name === 'gpt-pool');
      expect(gptPool!.models).toContain('gpt-4-renamed');
      expect(gptPool!.models).not.toContain('gpt-4');

      const mixedPool = result.modelGroups!.find(g => g.name === 'mixed-pool');
      expect(mixedPool!.models).toContain('gpt-4-renamed');
      expect(mixedPool!.models).not.toContain('gpt-4');
    });

    it('旧名 === 新名 时应该幂等（不变更任何内容）', () => {
      const config = makeBaseConfig();
      const result = renameModelInConfig(config, 'gpt-4', 'gpt-4');

      const gptPool = result.modelGroups!.find(g => g.name === 'gpt-pool');
      expect(gptPool!.models).toEqual(['gpt-4', 'gpt-3.5']);
    });

    it('无 modelGroups 时不应该报错', () => {
      const config: ProxyConfig = {
        models: [makeModel('a'), makeModel('b')],
      };
      const result = renameModelInConfig(config, 'a', 'a-renamed');

      expect(result.modelGroups).toBeUndefined();
      expect(result.models[0].customModel).toBe('a');
      expect(result.models[1].customModel).toBe('b');
    });

    it('modelGroups 存在但没有引用该模型时也应该正常返回', () => {
      const config: ProxyConfig = {
        models: [makeModel('a'), makeModel('b')],
        modelGroups: [{ name: 'g1', models: ['b'] }],
      };
      const result = renameModelInConfig(config, 'a', 'a-renamed');

      expect(result.modelGroups![0].models).toEqual(['b']);
    });

    it('不应该修改原始 config 对象', () => {
      const config = makeBaseConfig();
      const snapshot = JSON.stringify(config);
      renameModelInConfig(config, 'gpt-4', 'gpt-4-new');

      expect(JSON.stringify(config)).toBe(snapshot);
    });
  });

  describe('removeModelGroupFromConfig', () => {
    it('应该从 modelGroups 数组中移除指定组', () => {
      const config = makeBaseConfig();
      const result = removeModelGroupFromConfig(config, 'gpt-pool');

      expect(result.modelGroups!.find(g => g.name === 'gpt-pool')).toBeUndefined();
      expect(result.modelGroups!.find(g => g.name === 'mixed-pool')).toBeDefined();
      expect(result.modelGroups!.find(g => g.name === 'single-claude')).toBeDefined();
    });

    it('不存在的 group 应该抛错', () => {
      const config = makeBaseConfig();
      expect(() => removeModelGroupFromConfig(config, 'nonexistent'))
        .toThrow('未找到 Model Group：nonexistent');
    });

    it('不应该影响 models 和 userApiKeys', () => {
      const config = makeBaseConfig();
      const result = removeModelGroupFromConfig(config, 'gpt-pool');

      expect(result.models).toHaveLength(3);
      expect(result.userApiKeys).toHaveLength(3);
    });

    it('modelGroups 缺失时抛错', () => {
      const config: ProxyConfig = { models: [makeModel('a')] };
      expect(() => removeModelGroupFromConfig(config, 'g1'))
        .toThrow('未找到 Model Group：g1');
    });

    it('不应该修改原始 config 对象', () => {
      const config = makeBaseConfig();
      const snapshot = JSON.stringify(config);
      removeModelGroupFromConfig(config, 'gpt-pool');

      expect(JSON.stringify(config)).toBe(snapshot);
    });
  });
});
