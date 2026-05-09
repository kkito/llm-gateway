import { describe, it, expect } from 'vitest';
import { createConfigContext } from '../../src/lib/config-context.js';
import { homedir } from 'os';
import { join } from 'path';

describe('CLI start.ts - config-dir parsing', () => {
  describe('createConfigContext integration', () => {
    it('uses default directory when no configDir provided', () => {
      const ctx = createConfigContext();
      const defaultDir = join(homedir(), '.llm-gateway');
      expect(ctx.configDir).toBe(defaultDir);
      expect(ctx.configPath).toBe(join(defaultDir, 'config.json'));
      expect(ctx.pidFile).toBe(join(defaultDir, 'llm-gateway.pid'));
      expect(ctx.logDir).toBe(join(defaultDir, 'logs', 'proxy'));
    });

    it('uses custom directory when configDir provided', () => {
      const ctx = createConfigContext('/custom/path');
      expect(ctx.configDir).toBe('/custom/path');
      expect(ctx.configPath).toBe('/custom/path/config.json');
      expect(ctx.pidFile).toBe('/custom/path/llm-gateway.pid');
      expect(ctx.logDir).toBe('/custom/path/logs/proxy');
      expect(ctx.detailLogDir).toBe('/custom/path/logs');
    });

    it('ensures --stop uses correct PID file for configDir', () => {
      const ctx = createConfigContext('/my/gateway');
      // PID file must be in the same configDir
      expect(ctx.pidFile).toContain('/my/gateway');
      expect(ctx.pidFile).toBe('/my/gateway/llm-gateway.pid');
    });
  });
});
