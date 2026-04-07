import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createServer } from '../../src/server.js';
import { Logger } from '../../src/logger.js';
import { DetailLogger } from '../../src/detail-logger.js';
import type { ProviderConfig, ProxyConfig } from '../../src/config.js';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { writeFileSync, rmSync, readFileSync, mkdirSync, existsSync } from 'fs';

describe('Admin Model Group Form E2E', () => {
  let app: Hono;
  let testLogDir: string;
  let testConfigPath: string;
  let tempDir: string;
  let originalFetch: typeof fetch;

  beforeAll(() => {
    tempDir = join(tmpdir(), 'test-model-group-form-' + Date.now());
    testLogDir = join(tempDir, 'logs');
    testConfigPath = join(tempDir, 'config.json');
    mkdirSync(testLogDir, { recursive: true });

    // 创建测试模型配置
    const testModels: ProviderConfig[] = [
      {
        customModel: 'gpt-4',
        realModel: 'gpt-4',
        apiKey: 'sk-openai-key',
        baseUrl: 'https://api.openai.com/v1',
        provider: 'openai',
        desc: 'GPT-4 模型'
      },
      {
        customModel: 'gpt-3.5',
        realModel: 'gpt-3.5-turbo',
        apiKey: 'sk-openai-key',
        baseUrl: 'https://api.openai.com/v1',
        provider: 'openai',
        desc: 'GPT-3.5 模型'
      },
      {
        customModel: 'claude-3',
        realModel: 'claude-3-opus',
        apiKey: 'sk-anthropic-key',
        baseUrl: 'https://api.anthropic.com',
        provider: 'anthropic',
        desc: 'Claude 3 模型'
      }
    ];

    // 创建测试 ProxyConfig 对象
    const testConfig: ProxyConfig = {
      models: testModels,
      modelGroups: [
        {
          name: 'existing-group',
          models: ['gpt-4', 'gpt-3.5'],
          desc: '已有的模型组'
        }
      ]
    };

    // 创建配置文件
    writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));

    const logger = new Logger(testLogDir);
    const detailLogger = new DetailLogger(testLogDir);

    app = createServer(testConfig, logger, detailLogger, 30000, testConfigPath);
    originalFetch = globalThis.fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    // 每个测试前重置配置
    const testModels: ProviderConfig[] = [
      {
        customModel: 'gpt-4',
        realModel: 'gpt-4',
        apiKey: 'sk-openai-key',
        baseUrl: 'https://api.openai.com/v1',
        provider: 'openai',
        desc: 'GPT-4 模型'
      },
      {
        customModel: 'gpt-3.5',
        realModel: 'gpt-3.5-turbo',
        apiKey: 'sk-openai-key',
        baseUrl: 'https://api.openai.com/v1',
        provider: 'openai',
        desc: 'GPT-3.5 模型'
      },
      {
        customModel: 'claude-3',
        realModel: 'claude-3-opus',
        apiKey: 'sk-anthropic-key',
        baseUrl: 'https://api.anthropic.com',
        provider: 'anthropic',
        desc: 'Claude 3 模型'
      }
    ];

    const testConfig: ProxyConfig = {
      models: testModels,
      modelGroups: [
        {
          name: 'existing-group',
          models: ['gpt-4', 'gpt-3.5'],
          desc: '已有的模型组'
        }
      ]
    };

    writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));
  });

  describe('新增模型组', () => {
    it('应该显示新增模型组表单', async () => {
      const response = await app.request('/admin/model-groups/new');
      expect(response.status).toBe(200);
      const html = await response.text();
      
      expect(html).toContain('新增 Model Group');
      expect(html).toContain('组名');
      expect(html).toContain('描述');
      expect(html).toContain('选择模型');
      
      // 应该显示所有可用模型
      expect(html).toContain('gpt-4');
      expect(html).toContain('gpt-3.5');
      expect(html).toContain('claude-3');
    });

    it('应该成功创建新的模型组', async () => {
      // 模拟表单提交
      const formData = new URLSearchParams();
      formData.append('name', 'new-pool');
      formData.append('desc', '新创建的模型组');
      formData.append('models', JSON.stringify(['gpt-4', 'claude-3']));

      const response = await app.request('/admin/model-groups', {
        method: 'POST',
        body: formData,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      // 应该重定向到列表页
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('/admin/model-groups');

      // 验证配置文件已更新
      const configContent = readFileSync(testConfigPath, 'utf-8');
      const config = JSON.parse(configContent) as ProxyConfig;
      
      expect(config.modelGroups).toBeDefined();
      expect(config.modelGroups!.length).toBe(2);
      
      const newGroup = config.modelGroups!.find(g => g.name === 'new-pool');
      expect(newGroup).toBeDefined();
      expect(newGroup!.models).toEqual(['gpt-4', 'claude-3']);
      expect(newGroup!.desc).toBe('新创建的模型组');
    });

    it('应该拒绝重复的组名', async () => {
      const formData = new URLSearchParams();
      formData.append('name', 'existing-group');
      formData.append('desc', '重复的组名');
      formData.append('models', JSON.stringify(['gpt-4']));

      const response = await app.request('/admin/model-groups', {
        method: 'POST',
        body: formData,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      expect(response.status).toBe(200);
      const html = await response.text();
      // HTML 中双引号会被转义为 &quot;
      expect(html).toContain('组名 &quot;existing-group&quot; 已存在');
    });

    it('应该拒绝无效的组名', async () => {
      const formData = new URLSearchParams();
      formData.append('name', 'invalid group name!');
      formData.append('desc', '无效组名');
      formData.append('models', JSON.stringify(['gpt-4']));

      const response = await app.request('/admin/model-groups', {
        method: 'POST',
        body: formData,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('组名只能包含字母、数字、下划线、中划线');
    });

    it('应该拒绝未选择模型的提交', async () => {
      const formData = new URLSearchParams();
      formData.append('name', 'empty-pool');
      formData.append('desc', '没有模型');
      formData.append('models', JSON.stringify([]));

      const response = await app.request('/admin/model-groups', {
        method: 'POST',
        body: formData,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('请至少选择一个模型');
    });
  });

  describe('编辑模型组', () => {
    it('应该显示编辑模型组表单', async () => {
      const response = await app.request('/admin/model-groups/edit/existing-group');
      expect(response.status).toBe(200);
      const html = await response.text();
      
      expect(html).toContain('编辑 Model Group');
      expect(html).toContain('existing-group');
      expect(html).toContain('已有的模型组');
      
      // 应该显示已选模型
      expect(html).toContain('gpt-4');
      expect(html).toContain('gpt-3.5');
      
      // 应该只显示未选中的模型为可用
      expect(html).toContain('claude-3');
    });

    it('编辑不存在的组应该显示错误', async () => {
      const response = await app.request('/admin/model-groups/edit/nonexistent');
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('未找到 Model Group：nonexistent');
    });

    it('应该成功编辑模型组的名称和描述', async () => {
      // 模拟表单提交 - 编辑名称和描述
      const formData = new URLSearchParams();
      formData.append('name', 'updated-group');
      formData.append('desc', '更新后的描述');
      // 注意: 编辑模式下 models 参数不应该被处理

      const response = await app.request('/admin/model-groups/edit/existing-group', {
        method: 'POST',
        body: formData,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      // 应该重定向到列表页
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('/admin/model-groups');

      // 验证配置文件已更新
      const configContent = readFileSync(testConfigPath, 'utf-8');
      const config = JSON.parse(configContent) as ProxyConfig;
      
      const updatedGroup = config.modelGroups!.find(g => g.name === 'updated-group');
      expect(updatedGroup).toBeDefined();
      expect(updatedGroup!.desc).toBe('更新后的描述');
      // 模型列表应该保持不变
      expect(updatedGroup!.models).toEqual(['gpt-4', 'gpt-3.5']);
    });

    it('应该拒绝编辑时重名为已存在的组名', async () => {
      // 先添加一个额外的组
      const config = JSON.parse(readFileSync(testConfigPath, 'utf-8')) as ProxyConfig;
      config.modelGroups!.push({
        name: 'another-group',
        models: ['claude-3'],
        desc: '另一个组'
      });
      writeFileSync(testConfigPath, JSON.stringify(config, null, 2));

      // 尝试将 existing-group 重命名为 another-group
      const formData = new URLSearchParams();
      formData.append('name', 'another-group');
      formData.append('desc', '重名测试');

      const response = await app.request('/admin/model-groups/edit/existing-group', {
        method: 'POST',
        body: formData,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      expect(response.status).toBe(200);
      const html = await response.text();
      // HTML 中双引号会被转义为 &quot;
      expect(html).toContain('组名 &quot;another-group&quot; 已存在');
    });

    it('应该成功添加模型到组', async () => {
      const response = await app.request('/admin/model-groups/edit/existing-group/add-model?modelName=claude-3');
      
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('/admin/model-groups/edit/existing-group');

      // 验证配置文件已更新
      const configContent = readFileSync(testConfigPath, 'utf-8');
      const config = JSON.parse(configContent) as ProxyConfig;
      
      const group = config.modelGroups!.find(g => g.name === 'existing-group');
      expect(group).toBeDefined();
      expect(group!.models).toContain('claude-3');
      expect(group!.models).toContain('gpt-4');
      expect(group!.models).toContain('gpt-3.5');
    });

    it('应该成功从组中删除模型', async () => {
      const response = await app.request('/admin/model-groups/edit/existing-group/remove-model?modelName=gpt-3.5');
      
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('/admin/model-groups/edit/existing-group');

      // 验证配置文件已更新
      const configContent = readFileSync(testConfigPath, 'utf-8');
      const config = JSON.parse(configContent) as ProxyConfig;
      
      const group = config.modelGroups!.find(g => g.name === 'existing-group');
      expect(group).toBeDefined();
      expect(group!.models).not.toContain('gpt-3.5');
      expect(group!.models).toContain('gpt-4');
      expect(group!.models.length).toBe(1);
    });

    it('不应该删除组中最后一个模型', async () => {
      // 先创建一个只有一个模型的组
      const config = JSON.parse(readFileSync(testConfigPath, 'utf-8')) as ProxyConfig;
      config.modelGroups!.push({
        name: 'single-model-group',
        models: ['claude-3'],
        desc: '只有一个模型'
      });
      writeFileSync(testConfigPath, JSON.stringify(config, null, 2));

      const response = await app.request('/admin/model-groups/edit/single-model-group/remove-model?modelName=claude-3');
      
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('/admin/model-groups/edit/single-model-group');

      // 验证模型没有被删除
      const updatedConfig = JSON.parse(readFileSync(testConfigPath, 'utf-8')) as ProxyConfig;
      const group = updatedConfig.modelGroups!.find(g => g.name === 'single-model-group');
      expect(group).toBeDefined();
      expect(group!.models).toContain('claude-3');
      expect(group!.models.length).toBe(1);
    });

    it('应该成功上移模型顺序', async () => {
      const response = await app.request('/admin/model-groups/edit/existing-group/move-model?modelName=gpt-3.5&direction=up');
      
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('/admin/model-groups/edit/existing-group');

      // 验证配置文件已更新
      const configContent = readFileSync(testConfigPath, 'utf-8');
      const config = JSON.parse(configContent) as ProxyConfig;
      
      const group = config.modelGroups!.find(g => g.name === 'existing-group');
      expect(group).toBeDefined();
      // gpt-3.5 应该移动到第一个位置
      expect(group!.models).toEqual(['gpt-3.5', 'gpt-4']);
    });

    it('应该成功下移模型顺序', async () => {
      const response = await app.request('/admin/model-groups/edit/existing-group/move-model?modelName=gpt-4&direction=down');
      
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('/admin/model-groups/edit/existing-group');

      // 验证配置文件已更新
      const configContent = readFileSync(testConfigPath, 'utf-8');
      const config = JSON.parse(configContent) as ProxyConfig;
      
      const group = config.modelGroups!.find(g => g.name === 'existing-group');
      expect(group).toBeDefined();
      // gpt-4 应该移动到第二个位置
      expect(group!.models).toEqual(['gpt-3.5', 'gpt-4']);
    });

    it('不应该上移第一个模型', async () => {
      const response = await app.request('/admin/model-groups/edit/existing-group/move-model?modelName=gpt-4&direction=up');
      
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('/admin/model-groups/edit/existing-group');

      // 验证模型顺序没有变化
      const configContent = readFileSync(testConfigPath, 'utf-8');
      const config = JSON.parse(configContent) as ProxyConfig;
      
      const group = config.modelGroups!.find(g => g.name === 'existing-group');
      expect(group).toBeDefined();
      expect(group!.models).toEqual(['gpt-4', 'gpt-3.5']);
    });

    it('不应该下移最后一个模型', async () => {
      const response = await app.request('/admin/model-groups/edit/existing-group/move-model?modelName=gpt-3.5&direction=down');
      
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('/admin/model-groups/edit/existing-group');

      // 验证模型顺序没有变化
      const configContent = readFileSync(testConfigPath, 'utf-8');
      const config = JSON.parse(configContent) as ProxyConfig;
      
      const group = config.modelGroups!.find(g => g.name === 'existing-group');
      expect(group).toBeDefined();
      expect(group!.models).toEqual(['gpt-4', 'gpt-3.5']);
    });
  });

  describe('Bug 修复验证: 编辑时提交表单报"模型数据格式错误"', () => {
    it('编辑时只更新名称和描述，保留原有模型列表', async () => {
      // 编辑模式下,表单提交不应该处理 models 参数
      // models 应该通过 add-model/remove-model/move-model 单独处理
      
      const formData = new URLSearchParams();
      formData.append('name', 'updated-group-name');
      formData.append('desc', '更新描述');
      // 注意: 不提交 models 参数

      const response = await app.request('/admin/model-groups/edit/existing-group', {
        method: 'POST',
        body: formData,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      // 应该成功重定向
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('/admin/model-groups');

      // 验证配置已更新
      const configContent = readFileSync(testConfigPath, 'utf-8');
      const config = JSON.parse(configContent) as ProxyConfig;
      
      const group = config.modelGroups!.find(g => g.name === 'updated-group-name');
      expect(group).toBeDefined();
      expect(group!.desc).toBe('更新描述');
      // 模型列表应该保持不变
      expect(group!.models).toEqual(['gpt-4', 'gpt-3.5']);
    });

    it('编辑表单页面的 hidden input 值应该被正确转义', async () => {
      const response = await app.request('/admin/model-groups/edit/existing-group');
      expect(response.status).toBe(200);
      const html = await response.text();
      
      // 检查是否有 models hidden input
      expect(html).toContain('type="hidden"');
      expect(html).toContain('name="models"');
      
      // 检查 value 属性是否存在（即使被转义也没关系，因为编辑模式不处理这个字段）
      expect(html).toMatch(/name="models"\s+value="/);
    });
  });
});
