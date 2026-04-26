# Model Test Feature Design

**Date:** 2026-04-26
**Branch:** `feature/model-test`

## Purpose

在模型编辑页面（新增和编辑都可用）提供一个可折叠的测试模块，让用户发送真实请求到配置的 LLM API，验证配置是否正确。

## Architecture

### 后端路由

**端点**: `POST /admin/models/test`

不需要模型已保存，从请求体直接读取配置。

**请求体** (JSON):
```json
{
  "provider": "openai" | "anthropic",
  "baseUrl": "https://api.example.com",
  "apiKey": "sk-xxx",
  "realModel": "gpt-4",
  "message": "请介绍一下你自己"
}
```

**响应体** (JSON) - 成功:
```json
{
  "success": true,
  "model": "gpt-4",
  "content": "AI 返回的完整内容...",
  "usage": { "prompt_tokens": 10, "completion_tokens": 50 }
}
```

**响应体** (JSON) - 失败:
```json
{
  "success": false,
  "message": "HTTP 401: Invalid API key",
  "rawResponse": "{...}"
}
```

### 实现方式

- 复用 `OpenAIProvider` / `AnthropicProvider` 构建 URL 和 headers
- 发送 `chat/completions` 非流式请求，`max_tokens=256`
- 15 秒超时 (`AbortSignal.timeout(15000)`)
- 解析响应，提取 content 和 usage

### 前端组件

**文件**: `src/admin/views/model-test.tsx`

独立 TSX 组件，在 `model-form.tsx` 中引入并渲染。

**Props**: 不需要 props（组件从表单 DOM 元素读取值）

### UI 结构

```
<details class="test-section">
  <summary>🔍 测试模型配置</summary>
  
  <textarea id="testMessage">请介绍一下你自己</textarea>
  <button id="testBtn" onclick="runTest()">发送测试请求</button>
  
  <!-- 加载状态 -->
  <div id="testLoading" style="display:none">请求中...</div>
  
  <!-- 成功结果 -->
  <div id="testResult" style="display:none">
    <div>模型: gpt-4</div>
    <pre>AI 返回的完整内容...</pre>
    <div>Tokens: input=10, output=50</div>
  </div>
  
  <!-- 错误结果 -->
  <div id="testError" style="display:none">
    <pre>错误信息...</pre>
    <details>
      <summary>查看原始响应</summary>
      <pre>{原始响应}</pre>
    </details>
  </div>
</details>
```

### 前端交互流程

1. 用户点击"发送测试请求"
2. JS 从表单 DOM 元素读取 `#baseUrl`, `#provider`, `#apiKey`, `#realModel`
3. `fetch('/admin/models/test', { method: 'POST', body: JSON.stringify(data) })`
4. 根据响应渲染 `#testResult` 或 `#testError`
5. 请求中禁用按钮，显示 loading

### 在 model-form.tsx 中的集成位置

```
<form>
  <!-- 原有表单字段 -->
  <input id="customModel" />
  <input id="realModel" />
  <select id="provider" />
  <input id="baseUrl" />
  <input id="apiKey" />
  ...
  
  <!-- 测试模块（在表单字段和提交按钮之间） -->
  <ModelTest />
  
  <!-- 提交按钮 -->
  <div class="form-actions">
    <button type="submit">保存</button>
  </div>
</form>
```

## Error Handling

| 场景 | 处理方式 |
|------|---------|
| 请求超时 (15s) | `success: false, message: "请求超时（15秒），请检查网络连接或 API 地址"` |
| HTTP 错误 (401/403/429/500) | 解析错误响应体，展示 message + 原始响应 |
| 网络不可达 | `success: false, message: "网络错误: ${error.message}"` |
| 表单必填字段为空 | 前端 JS 校验，阻止发送 |

## Testing Strategy

- **后端路由**: E2E `app.request()` 测试，模拟 `POST /admin/models/test`，mock fetch
- **前端组件**: TSX 渲染测试，验证 HTML 结构、折叠状态、结果展示

## File Changes

| File | Action | Purpose |
|------|--------|---------|
| `src/admin/views/model-test.tsx` | New | 测试模块 TSX 组件 |
| `src/admin/routes/model-form.tsx` | Modify | 添加 `POST /admin/models/test` 路由，引入 ModelTest 组件 |
