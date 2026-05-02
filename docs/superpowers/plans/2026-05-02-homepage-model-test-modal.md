# Plan: Homepage Model Test Modal

## Overview
Add a test button to each model row on the admin homepage (`/admin/models`) that opens a modal for quick model testing with metrics display.

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/admin/components/ModelTestModal.tsx` | Create | New reusable modal component |
| `src/admin/views/models.tsx` | Modify | Add test button and integrate modal |

## Implementation Steps

### Step 1: Create ModelTestModal Component

**Location**: `src/admin/components/ModelTestModal.tsx`

**Props**:
- `isOpen: boolean` - controls visibility
- `onClose: () => void` - close callback
- `modelConfig: { customModel: string; realModel: string; baseUrl: string; provider: string; apiKey: string }` - model to test

**Features**:
- Centered modal with backdrop (`rgba(0,0,0,0.5)`)
- Close on ✕ button, backdrop click, or ESC key
- Pre-filled form with model config info (read-only display)
- Text input for test message (default: "请介绍一下你自己")
- Send button that calls `POST /admin/models/test`
- Metrics display in 2×3 grid:
  - 总耗时 (Total Time) - client-side measured
  - Token 总量 (Total Tokens)
  - Prompt Tokens
  - Completion Tokens
  - 生成速度 (Tokens/sec)
- Scrollable content area for response
- Collapsible raw JSON response
- Loading state with disabled button and spinner
- Error state with red border styling

### Step 2: Modify models.tsx

**Changes**:
- Import `ModelTestModal` component
- Add state for modal visibility and selected model config
- Add "⚡测试" button in the actions cell, between "编辑" and "限制"
- Wire up button click to open modal with model config
- Render `ModelTestModal` at the bottom of the component

### Step 3: Backend Integration

No backend changes required - `POST /admin/models/test` already exists in `model-form.tsx`.

### Step 4: Styling

Use existing CSS variables from `models.tsx`:
- `--bg-card`, `--bg-page`, `--border-color`
- `--text-primary`, `--text-secondary`
- `--accent-gradient`, `--accent-color`
- `--shadow-sm`, `--shadow-lg`, `--radius`, `--radius-sm`
- `--danger-color`, `--danger-bg`

### Step 5: Tests

Create test file: `tests/views/homepage-model-test-modal.test.tsx`

Test coverage:
- Modal opens/closes correctly
- Test button renders in correct position
- Metrics display correctly with valid response
- Error state displays correctly
- Loading state disables button and shows spinner

## Success Criteria
- `npm test` passes
- `pnpm build` succeeds
- Test button appears between "编辑" and "限制" on each model row
- Modal opens with correct pre-filled data
- Metrics display correctly after successful test
- Error handling works gracefully
- All styling uses existing CSS variables
