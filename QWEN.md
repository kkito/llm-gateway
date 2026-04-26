# QWEN.md — LLM Gateway Project Context

## Project Overview

**LLM Gateway** (`@kkito/llm-gateway`) is a lightweight LLM Proxy Gateway that provides unified management of multiple LLM APIs. It acts as a single entry point that can route requests to different LLM providers (OpenAI, Anthropic, etc.) with format conversion, caching, rate limiting, and usage statistics.

**Version:** 1.2.1 | **License:** GPLv3 | **Author:** kkito

### Core Features

- 🔄 **Format Conversion**: Bidirectional conversion between OpenAI and Anthropic API formats
- 🌊 **Streaming Support**: Full streaming response format conversion
- 💾 **Cache Token**: Cache Token support for faster responses
- 🔥 **Hot Reload**: Configuration changes take effect automatically
- 📊 **Statistics Dashboard**: Web interface for request stats and token usage
- 🎯 **Daemon Mode**: Run as a background daemon process
- 🔐 **Admin Interface**: Web-based admin panel with password protection, API key management, user management, model groups, and rate limiting

### Architecture

Built with **Hono** ( lightweight web framework) on **Node.js** with **TypeScript**. Uses TSX (Hono JSX) for server-side rendered admin views.

```
src/
├── cli/              # CLI entry point (commander)
├── routes/           # Core proxy routes (chat-completions, messages)
├── admin/            # Admin web interface (routes, views, components, middleware)
├── user/             # User-facing web interface
├── converters/       # OpenAI ↔ Anthropic format converters
├── providers/        # Provider-specific implementations
├── lib/              # Shared utilities (stats, rate-limiter, usage-tracker, etc.)
├── server.ts         # Main Hono app assembly
├── config.ts         # Config loading/validation
├── logger.ts         # Structured logging
└── detail-logger.ts  # Detailed request/response logging
```

## Tech Stack

| Category | Technology |
|----------|-----------|
| Runtime | Node.js (ESM) |
| Framework | Hono + @hono/node-server |
| Language | TypeScript (strict mode) |
| JSX | Hono JSX (react-jsx import source) |
| CLI | Commander |
| Testing | Vitest |
| CSS | Pico CSS |
| Package Manager | pnpm |

## Commands

```bash
# Install dependencies
pnpm install

# Build (TypeScript → dist/)
pnpm build

# Run tests
npm test              # one-shot

# Start (foreground)
pnpm start

# Start (daemon mode)
pnpm start -- --daemon

# Development (watch mode compilation)
pnpm dev
```

## Configuration

Config file location: `~/.llm-gateway/config.json`

Key config structure (`ProxyConfig`):
- `models`: Array of `ProviderConfig` (customModel, realModel, apiKey, baseUrl, provider, limits, hidden)
- `modelGroups`: Array of `ModelGroup` (name, models[], desc)
- `adminPassword`: SHA256 hash
- `apiKeys`: Admin API keys
- `userApiKeys`: User-facing API keys

## Testing Strategy

### Rules

**Every `src/` module must have a corresponding test.** Tests must cover normal paths, edge cases, and error paths. Push only after `npm test` passes.

**Three tiers:**
1. **Unit tests** — test individual functions/classes in isolation
2. **TSX view tests** — render components via `String(<Component />)`, validate HTML output and inline `<script>` syntax with `new Function(scriptContent)`
3. **Integration tests** — use `app.request()` to simulate HTTP calls

**Test file naming:** `tests/<path-to-module>.test.ts` mirroring `src/` structure (e.g. `src/lib/foo.ts` → `tests/lib/foo.test.ts`, `src/admin/views/models.tsx` → `tests/views/models.test.tsx`)

**Example:** `config.ts` unit tests should cover: load valid config, malformed JSON, missing fields, model group validation, API key CRUD, save/update/delete operations, empty config.

## Key Patterns

- **Factory functions**: Routes are created via factory functions (e.g., `createChatCompletionsRoute()`) that accept config getters and dependencies
- **Config getter pattern**: `() => currentConfig` passed to routes to enable hot-reload without recreating routes
- **Singleton pattern**: `UsageTracker` uses singleton pattern with `getInstance()` and `resetInstance()` for testing
- **Middleware chain**: Auth middleware registered before admin routes, with explicit exemptions for login/password routes
- **Path alias**: `@/` resolves to `./src/` in vitest config

## Admin Routes

| Route | Purpose |
|-------|---------|
| `/admin/models` | Model list management |
| `/admin/model-form` | Model create/edit form |
| `/admin/model-limits` | Rate limit configuration |
| `/admin/model-groups` | Model group management |
| `/admin/stats` | Usage statistics dashboard |
| `/admin/password` | Admin password management |
| `/admin/api-keys` | API key management |
| `/admin/users` | User management |
| `/admin/login` | Admin login page |

## Important Notes

- Project uses **feature branches** for development; `dev` is the main development branch
- Tests must pass before pushing
- When local/remote versions diverge, use remote version as source of truth
- The `feature/model-management` branch has ongoing model management feature work
- Inline JS in TSX templates requires careful handling of newlines and escaping
