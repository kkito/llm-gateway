# Homepage Announcement Feature Design

**Date:** 2026-04-30
**Feature:** 前台首页顶部显示后台编辑的 Markdown 公告内容

---

## 1. 配置结构

在 `src/config.ts` 中新增：

```typescript
export interface UiSettings {
  enabled?: boolean;           // 是否启用公告，默认 false
  announcementMarkdown?: string; // Markdown 原始内容，可选
}

export interface ProxyConfig {
  models: ProviderConfig[];
  modelGroups?: ModelGroup[];
  adminPassword?: string;
  apiKeys?: ApiKey[];
  userApiKeys?: UserApiKey[];
  privacySettings?: PrivacySettings;
  uiSettings?: UiSettings;  // 新增
}
```

- `uiSettings` 是可选的，兼容旧配置
- `enabled` 控制是否渲染公告区域
- `announcementMarkdown` 为空或缺失时，即使 `enabled: true` 也不显示

---

## 2. 后台管理页面

新建两个文件：

### `src/admin/routes/announcement.tsx`（路由）

- `GET /admin/announcement` — 读取 `uiSettings`，渲染编辑页面
- `POST /admin/announcement` — 解析表单，更新 `uiSettings`，调用 `onConfigChange`
- 使用 `loadFullConfig` / `saveConfig` 读写配置

### `src/admin/views/announcement.tsx`（视图）

- 使用 Pico CSS（项目现有风格）
- 一个 `enabled` 开关（checkbox）
- 一个文本区（`textarea`）编辑 Markdown
- 一个预览区域，用 `marked` 把 Markdown 转成 HTML 显示
- 保存按钮、成功/错误提示

### `src/server.ts` 改动

- 导入并注册 `createAnnouncementRoute()`，使用 `configPath` 和 `onConfigChange`

---

## 3. 前台显示逻辑

在 `src/user/views/home.tsx` 中：

### 数据获取

- `HomePage` 组件新增 `uiSettings?: UiSettings` prop
- `createHomeRoute` 从 config 中读取 `uiSettings` 并传入

### 渲染逻辑（在 Hero 区域之前）

```tsx
{props.uiSettings?.enabled && props.uiSettings.announcementMarkdown ? (
  <div class="announcement-banner">
    <div dangerouslySetInnerHTML={{ __html: marked(props.uiSettings.announcementMarkdown) }} />
  </div>
) : null}
```

### 样式

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

### Markdown 转换

- 使用 `marked` 库在服务器端将 Markdown 转为 HTML
- 因为是管理员自己输入的内容，通过 `dangerouslySetInnerHTML` 插入是可控的

---

## 4. 测试策略

按项目规范，新增以下测试文件：

| 测试文件 | 类型 | 覆盖内容 |
|---------|------|---------|
| `tests/config-uiSettings.test.ts` | 单元测试 | `UiSettings` 接口、`loadFullConfig`/`saveConfig` 对 `uiSettings` 的读写 |
| `tests/admin/routes/announcement.test.tsx` | 集成测试 | `GET/POST /admin/announcement`，表单提交，配置更新回调 |
| `tests/user/views/home-announcement.test.tsx` | TSX 视图测试 | `enabled: true/false`、空内容、有内容时的渲染输出 |

---

## 5. 依赖变更

| 依赖 | 类型 | 用途 |
|------|------|------|
| `marked` | dependencies | Markdown → HTML 转换 |

---

## 6. 设计决策摘要

| 决策项 | 选择 | 原因 |
|--------|------|------|
| 显示位置 | Hero 上方（最顶部） | 最醒目，独立区域 |
| 后台编辑器 | 简单文本区 + 预览 | 轻量，符合项目风格 |
| Markdown 转 HTML | `marked` 库 | 轻量（~30KB），API 简单 |
| 空内容处理 | 完全不显示 | 无内容时保持页面干净 |
| 配置位置 | `uiSettings` 子对象 | 预留扩展，结构清晰 |
| `uiSettings` 结构 | `{ enabled?, announcementMarkdown? }` | 带开关，可控性强 |
