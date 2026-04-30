# Homepage Announcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现前台首页顶部显示后台编辑的 Markdown 公告内容

**Architecture:** 在 config 中新增 `uiSettings` 配置对象，后台提供 TSX 编辑页面（含预览），前台 HomePage 在 Hero 上方渲染 Markdown 转成的 HTML。使用 `marked` 库做 Markdown → HTML 转换。

**Tech Stack:** TypeScript, Hono JSX (TSX), marked, vitest

---

## File Structure

| 操作 | 文件路径 | 职责 |
|------|---------|------|
| 修改 | `src/config.ts` | 新增 `UiSettings` 接口，修改 `ProxyConfig` |
| 新建 | `src/admin/routes/announcement.tsx` | 后台路由（GET/POST） |
| 新建 | `src/admin/views/announcement.tsx` | 后台编辑页面视图 |
| 修改 | `src/server.ts` | 注册新路由 |
| 修改 | `src/user/views/home.tsx` | 新增公告渲染逻辑 |
| 修改 | `package.json` | 新增 `marked` 依赖 |
| 新建 | `tests/config-uiSettings.test.ts` | 配置单元测试 |
| 新建 | `tests/admin/routes/announcement.test.tsx` | 后台路由集成测试 |
| 新建 | `tests/user/views/home-announcement.test.tsx` | 前台视图测试 |

---

### Task 1: 安装 marked 依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装 marked 依赖**

```bash
cd /Users/kkito/proj/github/llm-gateway && pnpm add marked
```

- [ ] **Step 2: 验证安装**

Run: `cat package.json | grep marked`
Expected: `"marked": "^xx.xx.x"` 出现在 dependencies 中

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "feat: add marked dependency for markdown rendering"
```

---

### Task 2: 配置层 — UiSettings 接口与 ProxyConfig 扩展（TDD）

**Files:**
- Modify: `src/config.ts:1-50` (添加接口定义)
- Modify: `src/config.ts:55-65` (修改 ProxyConfig)
- Create: `tests/config-uiSettings.test.ts`

- [ ] **Step 1: 写失败的配置单元测试**

```typescript
// tests/config-uiSettings.test.ts
import { describe, it, expect } from 'vitest';
import { loadFullConfig, saveConfig } from '../src/config.js';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';

const TEST_CONFIG_PATH = '/tmp/test-uiSettings-config.json';

describe('UiSettings config', () => {
  afterEach(() => {
    if (existsSync(TEST_CONFIG_PATH)) {
      unlinkSync(TEST_CONFIG_PATH);
    }
  });

  it('should load config with uiSettings', () => {
    const config = {
      models: [],
      uiSettings: {
        enabled: true,
        announcementMarkdown: '# Hello'
      }
    };
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(config));
    const loaded = loadFullConfig(TEST_CONFIG_PATH);
    expect(loaded.uiSettings?.enabled).toBe(true);
    expect(loaded.uiSettings?.announcementMarkdown).toBe('# Hello');
  });

  it('should save config with uiSettings', () => {
    const config = {
      models: [],
      uiSettings: {
        enabled: false,
        announcementMarkdown: ''
      }
    };
    saveConfig(config, TEST_CONFIG_PATH);
    const saved = JSON.parse(require('fs').readFileSync(TEST_CONFIG_PATH, 'utf-8'));
    expect(saved.uiSettings?.enabled).toBe(false);
    expect(saved.uiSettings?.announcementMarkdown).toBe('');
  });

  it('should handle missing uiSettings gracefully', () => {
    const config = { models: [] };
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(config));
    const loaded = loadFullConfig(TEST_CONFIG_PATH);
    expect(loaded.uiSettings).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行测试，验证失败**

Run: `cd /Users/kkito/proj/github/llm-gateway && pnpm test -- tests/config-uiSettings.test.ts`
Expected: FAIL — `UiSettings` 类型不存在

- [ ] **Step 3: 修改 src/config.ts，添加 UiSettings 接口和修改 ProxyConfig**

在 `src/config.ts` 中，`PrivacySettings` 接口定义之后（约第 38 行附近），添加：

```typescript
/**
 * UI 配置设置
 */
export interface UiSettings {
  enabled?: boolean;           // 是否启用公告，默认 false
  announcementMarkdown?: string; // Markdown 原始内容，可选
}
```

修改 `ProxyConfig` 接口（约第 55 行附近），添加 `uiSettings` 字段：

```typescript
export interface ProxyConfig {
  models: ProviderConfig[];
  modelGroups?: ModelGroup[];
  adminPassword?: string;
  apiKeys?: ApiKey[];
  userApiKeys?: UserApiKey[];
  privacySettings?: PrivacySettings;
  uiSettings?: UiSettings;  // 新增 UI 设置
}
```

- [ ] **Step 4: 运行测试，验证通过**

Run: `cd /Users/kkito/proj/github/llm-gateway && pnpm test -- tests/config-uiSettings.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config-uiSettings.test.ts
git commit -m "feat(config): add UiSettings interface and extend ProxyConfig"
```

---

### Task 3: 后台视图 — AnnouncementPage 组件

**Files:**
- Create: `src/admin/views/announcement.tsx`

- [ ] **Step 1: 创建后台公告编辑页面视图**

```tsx
// src/admin/views/announcement.tsx
import { FC } from 'hono/jsx';
import { Layout } from '../components/Layout.js';
import type { UiSettings } from '../../config.js';

interface Props {
  settings?: UiSettings;
  success?: string;
  error?: string;
}

export const AnnouncementPage: FC<Props> = (props) => {
  const settings = props.settings || { enabled: false, announcementMarkdown: '' };

  return (
    <Layout title="公告管理 - LLM Gateway">
      <style dangerouslySetInnerHTML={{ __html: `
        .container { max-width: 800px; margin: 0 auto; padding: 1rem; }
        .card { background: #fff; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); padding: 1rem; margin-bottom: 1rem; }
        .form-group { margin-bottom: 1rem; }
        .form-group label { display: block; font-weight: 600; margin-bottom: 0.25rem; font-size: 0.85rem; }
        .form-group input[type="checkbox"] { accent-color: #6366f1; }
        .form-group textarea { width: 100%; min-height: 200px; padding: 0.5rem; border: 1px solid #e5e7eb; border-radius: 8px; font-family: monospace; font-size: 0.8rem; }
        .preview { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 0.75rem; margin-top: 1rem; }
        .preview h4 { margin: 0 0 0.5rem 0; font-size: 0.8rem; color: #6b7280; }
        .alert-success { background: #d1fae5; color: #065f46; padding: 0.5rem 0.75rem; border-radius: 8px; font-size: 0.8rem; margin-bottom: 1rem; }
        .alert-error { background: #fee2e2; color: #991b1b; padding: 0.5rem 0.75rem; border-radius: 8px; font-size: 0.8rem; margin-bottom: 1rem; }
        .btn-primary { background: linear-gradient(135deg, #6366f1, #4f46e5); color: white; border: none; padding: 0.4rem 0.8rem; border-radius: 8px; font-size: 0.8rem; cursor: pointer; }
      `}} />

      <div class="container">
        <h2>公告管理</h2>
        <p style={{fontSize: '0.8rem', color: '#6b7280', marginBottom: '1rem'}}>
          编辑将在前台首页顶部显示的公告内容（支持 Markdown 格式）
        </p>

        {props.success && (
          <div class="alert-success">{props.success}</div>
        )}
        {props.error && (
          <div class="alert-error">{props.error}</div>
        )}

        <div class="card">
          <form method="POST" action="/admin/announcement">
            <div class="form-group">
              <label>
                <input type="checkbox" name="enabled" checked={settings.enabled} />
                {' '}启用公告
              </label>
            </div>

            <div class="form-group">
              <label>Markdown 内容</label>
              <textarea
                name="announcementMarkdown"
                placeholder="# 公告标题&#10;&#10;这里是公告内容，支持 **Markdown** 格式..."
              >{settings.announcementMarkdown || ''}</textarea>
            </div>

            <button type="submit" class="btn-primary">保存</button>
          </form>
        </div>

        {(settings.announcementMarkdown && settings.enabled) ? (
          <div class="card">
            <div class="preview">
              <h4>预览</h4>
              <div id="preview-content"></div>
            </div>
          </div>
        ) : null}

        <a href="/admin/models" style={{fontSize: '0.8rem', color: '#6366f1'}}>← 返回模型管理</a>
      </div>

      {settings.announcementMarkdown ? (
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            var md = ${JSON.stringify(settings.announcementMarkdown)};
            if (typeof marked !== 'undefined') {
              document.getElementById('preview-content').innerHTML = marked.parse ? marked.parse(md) : marked(md);
            }
          })();
        `}} />
      ) : null}
    </Layout>
  );
};
```

- [ ] **Step 2: 验证可以编译**

Run: `cd /Users/kkito/proj/github/llm-gateway && pnpm build`
Expected: 编译成功，无错误

- [ ] **Step 3: Commit**

```bash
git add src/admin/views/announcement.tsx
git commit -m "feat(admin): add AnnouncementPage view component"
```

---

### Task 4: 后台路由 — announcement 路由（TDD）

**Files:**
- Create: `src/admin/routes/announcement.tsx`
- Create: `tests/admin/routes/announcement.test.tsx`

- [ ] **Step 1: 写失败的后台路由集成测试**

```tsx
// tests/admin/routes/announcement.test.tsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { AnnouncementPage } from '../../src/admin/views/announcement.js';

// 模拟 loadFullConfig 和 saveConfig
const mockConfig: any = {
  models: [],
  uiSettings: { enabled: false, announcementMarkdown: '' }
};

// 直接测试视图组件渲染
describe('AnnouncementPage', () => {
  it('should render with empty settings', () => {
    const html = String(<AnnouncementPage />);
    expect(html).toContain('公告管理');
    expect(html).toContain('Markdown 内容');
  });

  it('should render with existing settings', () => {
    const settings = {
      enabled: true,
      announcementMarkdown: '# Test Announcement'
    };
    const html = String(<AnnouncementPage settings={settings} />);
    expect(html).toContain('公告管理');
    expect(html).toContain('# Test Announcement');
  });

  it('should render success message', () => {
    const html = String(<AnnouncementPage success="设置已保存" />);
    expect(html).toContain('设置已保存');
  });

  it('should render error message', () => {
    const html = String(<AnnouncementPage error="保存失败" />);
    expect(html).toContain('保存失败');
  });
});
```

- [ ] **Step 2: 运行测试，验证失败**

Run: `cd /Users/kkito/proj/github/llm-gateway && pnpm test -- tests/admin/routes/announcement.test.tsx`
Expected: FAIL — 路由文件不存在（但视图测试应该能通过）

- [ ] **Step 3: 创建后台公告路由**

```tsx
// src/admin/routes/announcement.tsx
import { Hono } from 'hono';
import type { UiSettings, ProxyConfig } from '../../config.js';
import { AnnouncementPage } from '../views/announcement.js';
import { loadFullConfig, saveConfig } from '../../config.js';

interface RouteDeps {
  configPath: string;
  onConfigChange: (config: ProxyConfig) => void;
}

const DEFAULT_UI_SETTINGS: UiSettings = {
  enabled: false,
  announcementMarkdown: ''
};

export function createAnnouncementRoute(deps: RouteDeps) {
  const { configPath, onConfigChange } = deps;
  const app = new Hono();

  app.get('/admin/announcement', (c) => {
    try {
      const proxyConfig = loadFullConfig(configPath);
      const settings = proxyConfig.uiSettings || DEFAULT_UI_SETTINGS;
      return c.html(<AnnouncementPage settings={settings} />);
    } catch (error: any) {
      return c.html(
        <AnnouncementPage
          settings={DEFAULT_UI_SETTINGS}
          error={`加载失败：${error.message}`}
        />
      );
    }
  });

  app.post('/admin/announcement', async (c) => {
    try {
      const proxyConfig = loadFullConfig(configPath);
      const body = await c.req.parseBody();

      const settings: UiSettings = {
        enabled: body.enabled === 'on',
        announcementMarkdown: (body.announcementMarkdown as string) || ''
      };

      proxyConfig.uiSettings = settings;
      saveConfig(proxyConfig, configPath);
      onConfigChange(proxyConfig);

      return c.html(
        <AnnouncementPage settings={settings} success="设置已保存" />
      );
    } catch (error: any) {
      const proxyConfig = loadFullConfig(configPath);
      const settings = proxyConfig.uiSettings || DEFAULT_UI_SETTINGS;
      return c.html(
        <AnnouncementPage settings={settings} error={`保存失败：${error.message}`} />
      );
    }
  });

  return app;
}
```

- [ ] **Step 4: 运行测试，验证通过**

Run: `cd /Users/kkito/proj/github/llm-gateway && pnpm test -- tests/admin/routes/announcement.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/admin/routes/announcement.tsx tests/admin/routes/announcement.test.tsx
git commit -m "feat(admin): add announcement route with GET/POST handlers"
```

---

### Task 5: 注册路由到 server.ts

**Files:**
- Modify: `src/server.ts:1-30` (添加导入)
- Modify: `src/server.ts:120-140` (注册路由)

- [ ] **Step 1: 添加导入语句**

在 `src/server.ts` 的导入区域（约第 28 行附近），添加：

```typescript
import { createAnnouncementRoute } from './admin/routes/announcement.js';
```

- [ ] **Step 2: 注册路由**

在 `src/server.ts` 中，在隐私保护路由注册之后（约第 172 行附近），添加：

```typescript
  // 公告管理路由
  if (configPath) {
    app.route('', createAnnouncementRoute({
      configPath,
      onConfigChange
    }));
  }
```

- [ ] **Step 3: 验证编译**

Run: `cd /Users/kkito/proj/github/llm-gateway && pnpm build`
Expected: 编译成功

- [ ] **Step 4: Commit**

```bash
git add src/server.ts
git commit -m "feat(server): register announcement route"
```

---

### Task 6: 前台 HomePage 添加公告显示（TDD）

**Files:**
- Modify: `src/user/views/home.tsx` (添加公告渲染)
- Modify: `src/user/routes/home.tsx` (传递 uiSettings)
- Create: `tests/user/views/home-announcement.test.tsx`

- [ ] **Step 1: 写失败的前台视图测试**

```tsx
// tests/user/views/home-announcement.test.tsx
import { describe, it, expect } from 'vitest';
import { HomePage } from '../../../src/user/views/home.js';
import type { UiSettings } from '../../../src/config.js';

describe('HomePage Announcement', () => {
  const mockModels: any[] = [];
  const mockModelGroups: any[] = [];

  it('should not render announcement when disabled', () => {
    const uiSettings: UiSettings = { enabled: false, announcementMarkdown: '# Hello' };
    const html = String(<HomePage models={mockModels} modelGroups={mockModelGroups} uiSettings={uiSettings} />);
    expect(html).not.toContain('announcement-banner');
  });

  it('should not render announcement when markdown is empty', () => {
    const uiSettings: UiSettings = { enabled: true, announcementMarkdown: '' };
    const html = String(<HomePage models={mockModels} modelGroups={mockModelGroups} uiSettings={uiSettings} />);
    // 即使 enabled 为 true，空内容也不显示
    expect(html).not.toContain('announcement-banner');
  });

  it('should render announcement when enabled and has content', () => {
    const uiSettings: UiSettings = { enabled: true, announcementMarkdown: '# Hello World' };
    const html = String(<HomePage models={mockModels} modelGroups={mockModelGroups} uiSettings={uiSettings} />);
    expect(html).toContain('announcement-banner');
  });
});
```

- [ ] **Step 2: 运行测试，验证失败**

Run: `cd /Users/kkito/proj/github/llm-gateway && pnpm test -- tests/user/views/home-announcement.test.tsx`
Expected: FAIL — HomePage 还没有 uiSettings prop

- [ ] **Step 3: 修改 HomePage 组件，添加公告渲染**

在 `src/user/views/home.tsx` 中：

1. 修改 Props 接口（约第 768 行附近）：

```typescript
interface Props {
  models: ProviderConfig[];
  modelGroups?: ModelGroup[];
  userName?: string;
  uiSettings?: UiSettings;  // 新增
}
```

2. 在 Hero 区域之前（约第 778 行，`<div class="hero">` 之前），添加：

```tsx
      {/* 公告区域 - Hero 上方 */}
      {props.uiSettings?.enabled && props.uiSettings.announcementMarkdown ? (
        <div class="announcement-banner">
          <div dangerouslySetInnerHTML={{ __html: (globalThis as any).marked ? (globalThis as any).marked(props.uiSettings.announcementMarkdown) : props.uiSettings.announcementMarkdown }} />
        </div>
      ) : null}
```

3. 在样式中添加（在 `:root` 或样式块中添加）：

```css
.announcement-banner {
  background: linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%);
  border: 1px solid #6366f1;
  border-radius: var(--radius);
  padding: 0.6rem 0.85rem;
  margin-bottom: 0.75rem;
  font-size: 0.8rem;
}
.announcement-banner h1, .announcement-banner h2, .announcement-banner h3 {
  margin-top: 0;
}
```

注意：由于 marked 是运行时依赖，需要在 `home.tsx` 中导入：

在文件顶部添加：
```typescript
import { marked } from 'marked';
```

然后修改渲染逻辑为：
```tsx
<div dangerouslySetInnerHTML={{ __html: marked(props.uiSettings.announcementMarkdown) }} />
```

- [ ] **Step 4: 修改 home.tsx 路由，传递 uiSettings**

在 `src/user/routes/home.tsx` 中：

1. 修改导入（添加 `loadFullConfig`）：
```typescript
import { loadFullConfig } from '../../config.js';
```

2. 在 GET /user/main 处理函数中，添加 uiSettings 读取：

```typescript
  app.get('/user/main', (c) => {
    // 检查是否启用了认证
    let isAuthEnabled = false;
    if (configPath) {
      const fullConfig = loadFullConfig(configPath);
      isAuthEnabled = !!(fullConfig.userApiKeys && fullConfig.userApiKeys.length > 0);
    }

    // 未启用认证时，直接显示页面（无需登录）
    if (!isAuthEnabled) {
      const currentConfig = typeof config === 'function' ? config() : config;
      const fullConfig = configPath ? loadFullConfig(configPath) : undefined;
      return c.html(<HomePage models={currentConfig.models} modelGroups={currentConfig.modelGroups} userName={undefined} uiSettings={fullConfig?.uiSettings} />);
    }

    // 已启用认证，需要登录
    const currentUser = getCurrentUser(c, configPath);
    if (!currentUser) {
      return c.redirect('/user/login');
    }

    const currentConfig = typeof config === 'function' ? config() : config;
    const fullConfig = configPath ? loadFullConfig(configPath) : undefined;
    return c.html(<HomePage models={currentConfig.models} modelGroups={currentConfig.modelGroups} userName={currentUser.name} uiSettings={fullConfig?.uiSettings} />);
  });
```

- [ ] **Step 5: 运行测试，验证通过**

Run: `cd /Users/kkito/proj/github/llm-gateway && pnpm test -- tests/user/views/home-announcement.test.tsx`
Expected: PASS

- [ ] **Step 6: 运行全部测试**

Run: `cd /Users/kkito/proj/github/llm-gateway && pnpm test`
Expected: PASS

- [ ] **Step 7: 验证编译**

Run: `cd /Users/kkito/proj/github/llm-gateway && pnpm build`
Expected: 编译成功

- [ ] **Step 8: Commit**

```bash
git add src/user/views/home.tsx src/user/routes/home.tsx tests/user/views/home-announcement.test.tsx
git commit -m "feat(user): add announcement rendering to HomePage"
```

---

### Task 7: 最终验证与清理

- [ ] **Step 1: 运行全部测试**

Run: `cd /Users/kkito/proj/github/llm-gateway && pnpm test`
Expected: 所有测试通过

- [ ] **Step 2: 构建验证**

Run: `cd /Users/kkito/proj/github/llm-gateway && pnpm build`
Expected: 构建成功

- [ ] **Step 3: 更新设计文档中的测试文件列表（如有需要）**

检查 `docs/superpowers/specs/2026-04-30-homepage-announcement-design.md` 中的测试策略部分是否与实际一致。

- [ ] **Step 4: Final commit（如有修改）**

```bash
git add -A
git commit -m "chore: final cleanup for homepage announcement feature"
```

---

## Self-Review Checklist

✅ Spec coverage: 所有设计段（配置结构、后台页面、前台显示、测试策略、依赖变更）都有对应任务
✅ No placeholders: 所有步骤包含实际代码，无 TBD/TODO
✅ Type consistency: `UiSettings` 接口在 config.ts 定义，在视图和路由中一致使用
✅ File paths: 所有路径均为绝对路径或相对于项目根目录的正确路径
