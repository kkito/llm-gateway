import { describe, it, expect } from 'vitest';
import { createConfigContext } from '../../src/lib/config-context.js';
import { join } from 'path';
import { homedir } from 'os';

describe('ConfigContext', () => {
  it('creates context with default directory when no configDir provided', () => {
    const ctx = createConfigContext();
    expect(ctx.configDir).toBe(join(homedir(), '.llm-gateway'));
    expect(ctx.configPath).toBe(join(ctx.configDir, 'config.json'));
    expect(ctx.logDir).toBe(join(ctx.configDir, 'logs', 'proxy'));
    expect(ctx.detailLogDir).toBe(join(ctx.configDir, 'logs'));
    expect(ctx.pidFile).toBe(join(ctx.configDir, 'llm-gateway.pid'));
  });

  it('creates context with custom directory when configDir provided', () => {
    const ctx = createConfigContext('/my/custom/dir');
    expect(ctx.configDir).toBe('/my/custom/dir');
    expect(ctx.configPath).toBe('/my/custom/dir/config.json');
    expect(ctx.logDir).toBe('/my/custom/dir/logs/proxy');
    expect(ctx.detailLogDir).toBe('/my/custom/dir/logs');
    expect(ctx.pidFile).toBe('/my/custom/dir/llm-gateway.pid');
  });

  it('handles relative-like paths correctly', () => {
    const ctx = createConfigContext('./my-work');
    // path.join normalizes './my-work' to 'my-work'
    expect(ctx.configPath).toBe('my-work/config.json');
    expect(ctx.pidFile).toBe('my-work/llm-gateway.pid');
  });
});
