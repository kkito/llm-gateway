---
name: Homepage Model Test Modal
description: Add a test button to each model row on the homepage that opens a modal for quick testing with metrics display
type: project
---

# Design: Homepage Model Test Modal

## Context

The admin homepage (`/admin/models`) displays a list of configured models. Users want to quickly test any model from the list without navigating to a separate page.

## Architecture

### Components

1. **`ModelTestModal`** (`src/admin/components/ModelTestModal.tsx`) — New reusable modal component
   - Handles test form state (message input, loading, results, errors)
   - Displays 6 metric cards in a 2×3 grid
   - Shows scrollable response content area
   - Collapsible raw JSON response section

2. **`models.tsx`** — Modified to add test button per row and modal integration

### Data Flow

1. User clicks "测试" button on a model row
2. Modal opens with pre-filled model config (`customModel`, `realModel`, `baseUrl`, `provider`)
3. User enters test message (default: "请介绍一下你自己") and clicks "发送"
4. `POST /admin/models/test` is called with the model config and message
5. Response includes: `success`, `content`, `usage` (prompt_tokens, completion_tokens), `model`, `ttft` (time to first token), `totalTime`
6. Metrics are displayed, or error is shown if failed

### Modal Behavior

- **Open**: Click test button → modal appears with backdrop
- **Close**: Click ✕ button, click backdrop, or press ESC
- **Position**: Centered on screen
- **Backdrop**: Semi-transparent black `rgba(0,0,0,0.5)`

### Metrics Display

Five cards in a responsive grid (3+2 layout on desktop, 2×3 on smaller screens):

| Metric | Label | Data Source |
|--------|-------|-------------|
| 总耗时 | Total Time | Client-side: send click → response received (ms → formatted to seconds) |
| Token 总量 | Total Tokens | `usage.total_tokens` (or `prompt_tokens + completion_tokens`) |
| Prompt Tokens | Prompt | `usage.prompt_tokens` |
| Completion Tokens | Completion | `usage.completion_tokens` |
| 生成速度 | Tokens/sec | `completion_tokens / total_time`, formatted to `N t/s` |

### Content Area

- Scrollable `<pre>` block with white-space pre-wrap
- Shows model response content
- Max height: ~300px, overflow-y: auto
- Styled with `--bg-page` background, `--border-color` border

### Raw Response Section

- Collapsible via toggle link `[▼ 查看原始响应]`
- Shows full JSON response in a smaller `<pre>` block
- Useful for debugging

### Loading State

- Send button disabled with reduced opacity
- "请求中..." text with spinner animation
- Metric cards show "—" placeholder

### Error State

- Red border (`--danger-color`) on error area
- Error message displayed in styled box
- Raw response shown as collapsible section below error

## UI Integration

### Test Button

- Added to the actions cell, between "编辑" and "限制"
- Style: small secondary button with ⚡ icon
- Color: accent gradient matching global theme

```
↑ ↓ 隐藏 复制 编辑 ⚡测试 限制 ×
```

### Style Consistency

- All CSS uses existing CSS variables from `models.tsx`:
  - `--bg-card`, `--bg-page`, `--border-color`, `--text-primary`, `--text-secondary`
  - `--accent-gradient`, `--accent-color`
  - `--shadow-sm`, `--radius`, `--radius-sm`
  - `--danger-color`, `--danger-bg`
- Modal card: `background: var(--bg-card)`, `border-radius: var(--radius)`, `box-shadow: var(--shadow-lg)`
- Metric cards: same style pattern as other dashboard cards in the admin

## Backend

No changes required. The existing `POST /admin/models/test` route in `model-form.tsx` already handles the test logic and returns the necessary fields.

## Files Modified/Created

| File | Action | Purpose |
|------|--------|---------|
| `src/admin/components/ModelTestModal.tsx` | Create | New modal component with test form and metrics |
| `src/admin/views/models.tsx` | Modify | Add test button per row, integrate modal |

## Error Handling

- Network errors: caught by try/catch, displayed in error box
- API errors: `data.success === false` branch, shows error message
- Timeout: handled by existing backend (5 minute timeout)
- Invalid response: graceful fallback, shows "—" for missing fields
