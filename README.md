[English](./README.md) | [中文](./README_zh.md)

# LLM Gateway

LLM Proxy Gateway - Unified management of multiple LLM APIs

## Use Cases

- [Personal Developer API Management](docs/scenarios/personal-api-management.md)
- [Team LLM Resource Sharing](docs/scenarios/team-resource-sharing.md)
- [API Usage Statistics & Billing](docs/scenarios/usage-statistics-billing.md)
- [Multi-Model Testing](docs/scenarios/multi-model-switching.md)
- [Lightweight Alternative to Complex Open Source Solutions](docs/scenarios/lightweight-alternative.md)
- [Domestic Model Format Compatibility](docs/scenarios/domestic-model-compat.md)
- [Multi-Platform Fallback for Rate Limiting](docs/scenarios/multi-platform-fallback.md)

## Features

- 🔄 **Format Conversion**: Bidirectional conversion between OpenAI and Anthropic API formats
- 🌊 **Streaming Support**: Full streaming response format conversion
- 💾 **Cache Token**: Cache Token support for faster responses
- 🔥 **Hot Reload**: Configuration changes take effect automatically
- 📊 **Statistics Dashboard**: Web interface to view request stats and token usage
- 🎯 **Daemon Mode**: Run as a background daemon process

## Quick Start

### Installation

```bash
pnpm install
pnpm build
```

### Configuration

Create config file at `~/.llm-gateway/config.json`:

```json
{
  "models": [
    {
      "customModel": "my-gpt4",
      "realModel": "gpt-4",
      "apiKey": "sk-your-openai-key",
      "provider": "openai",
      "baseUrl": "https://api.openai.com",
      "desc": "GPT-4 model for daily conversations"
    },
    {
      "customModel": "my-claude",
      "realModel": "claude-3-5-sonnet-20241022",
      "apiKey": "sk-ant-your-anthropic-key",
      "provider": "anthropic",
      "baseUrl": "https://api.anthropic.com",
      "desc": "Claude model for long text processing"
    }
  ]
}
```

### Start

```bash
# Foreground
pnpm start

# Daemon mode
pnpm start -- --daemon

# Or use global command (after npm installation)
kkito-llm-gateway
```

#### Global Command Usage

```bash
# Start in foreground
kkito-llm-gateway

# Start in daemon mode (background)
kkito-llm-gateway -D

# Stop daemon service
kkito-llm-gateway --stop

# Specify port
kkito-llm-gateway -p 8080

# Specify config file and log directory
kkito-llm-gateway -c /path/to/config.json -l /path/to/logs

# Enable debug logging
kkito-llm-gateway --debug
```

#### CLI Options

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --port <number>` | Server port | `4000` |
| `-D, --daemon` | Run in background (daemon mode) | - |
| `--stop` | Stop the running daemon service | - |
| `-d, --dir <path>` | Working directory | `~/.llm-gateway/` |
| `-c, --config <path>` | Config file path | `<dir>/config.json` |
| `-l, --log-dir <path>` | Log directory | System default |
| `-t, --timeout <ms>` | Request timeout (ms) | `300000` |
| `--debug` | Enable verbose logging (full request/response) | - |

### Usage

```bash
# OpenAI format
curl http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "my-gpt4",
    "messages": [{"role": "user", "content": "Hello"}]
  }'

# Anthropic format
curl http://localhost:4000/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "my-claude",
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 1024
  }'
```

### Admin Interface

- **Home**: http://localhost:4000/user/main
- **Model Management**: http://localhost:4000/admin/models
- **Statistics Dashboard**: http://localhost:4000/admin/stats
- **Password Management**: http://localhost:4000/admin/password

> 🔐 First access to admin interface will prompt you to set a password to protect it from unauthorized access.

## Documentation

- [User Guide](docs/user-guide.md)
- [Admin Password Authentication](docs/admin-password.md)

## Development Notes

- [Built entirely with Qwen Code](docs/development/use-qwen-code.md)
- [The struggle of implementing Cache Token](docs/development/cache-token-struggle.md)
- [Longcat Platform Omni Model compatibility issues](docs/development/longcat-omni-bug.md)

## License

GPLv3