# 模型管理功能设计

## 概述

在 `feature/model-management` 分支上为 LLM Gateway 后台管理新增三个功能：模型复制、模型隐藏、首页模型列表。

---

## 功能一：模型复制

### 交互流程
1. 用户在后台模型列表页点击某模型的"复制"按钮
2. 弹出确认框：`确定要复制模型 "xxx" 吗？`
3. 确认后，后端复制该模型配置，新模型名称 = 原名 + 时间戳（如 `my-llm-20260425143022`）
4. 新模型插入到模型数组的**第一个位置**
5. 复制成功后，重定向到新模型的**编辑页**（`/admin/models/edit/:newModel`）

### 后端路由
- `POST /admin/models/copy/:model`
- 读取原模型配置，生成新名称（加时间戳），插入数组首位，保存并重定向

### 前端实现
- 在 `ModelsPage` 视图操作栏增加"复制"按钮
- JavaScript 处理确认框 → 提交 POST 请求

---

## 功能二：模型隐藏

### 数据结构
- `ProviderConfig` 新增 `hidden?: boolean` 字段

### 后台列表行为
- 每行有隐藏/显示开关（图标或切换按钮）
- 隐藏模型**排到列表最后**，有视觉标识（如置灰、隐藏标签）
- 点击切换时，提交 `POST /admin/models/toggle-hidden/:model`
- 隐藏→显示：模型排到**第一个**
- 显示→隐藏：模型排到**最后**

### 编辑表单
- 编辑页增加"隐藏模型"复选框/开关
- 保存时一并处理 hidden 状态和排序

### 首页用户端
- 首页仅展示 `hidden !== true` 的模型
- 隐藏模型对用户不可见

---

## 功能三：首页模型列表

### 设计
- 保持现有首页风格不变
- 在现有卡片区域下方新增一个紧凑表格区域
- 列出所有**未隐藏**的模型：名称、真实模型、描述
- 表格风格与后台管理页一致（复用现有 CSS 变量和样式）

---

## 路由汇总

| 路由 | 方法 | 功能 |
|---|---|---|
| `POST /admin/models/copy/:model` | POST | 复制模型 |
| `POST /admin/models/toggle-hidden/:model` | POST | 切换隐藏状态 |

---

## 文件变更

| 文件 | 变更 |
|---|---|
| `src/config.ts` | `ProviderConfig` 新增 `hidden` 字段 |
| `src/admin/routes/model-form.tsx` | 新增复制、隐藏路由，编辑表单处理 hidden 状态 |
| `src/admin/views/models.tsx` | 列表页增加复制按钮、隐藏开关、隐藏样式 |
| `src/user/views/home.tsx` | 新增模型列表表格，过滤隐藏模型 |
| `src/server.ts` | 无需改动（路由注册已包含） |
