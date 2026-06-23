import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const MAX_RAW_DATA_LENGTH = 500;

export interface SystemLogContext {
  requestId?: string;
  provider?: string;
}

export interface SystemLogEntry {
  timestamp: string;
  level: 'error';
  category: string;
  message: string;
  rawData?: string;
  requestId?: string;
  provider?: string;
}

class SystemLogger {
  private static instance: SystemLogger | null = null;
  private logDir: string;
  private initialized: boolean = false;

  private constructor(logDir: string) {
    this.logDir = logDir;
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
    this.initialized = true;
  }

  static init(logDir: string): SystemLogger {
    if (!SystemLogger.instance) {
      SystemLogger.instance = new SystemLogger(logDir);
    }
    return SystemLogger.instance;
  }

  static getInstance(): SystemLogger | null {
    return SystemLogger.instance;
  }

  static resetInstance(): void {
    SystemLogger.instance = null;
  }

  private getCurrentLogPath(): string {
    const filename = `system-${new Date().toISOString().split('T')[0]}.log`;
    return join(this.logDir, filename);
  }

  getFilePath(): string {
    return this.getCurrentLogPath();
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  logError(
    category: string,
    message: string,
    rawData?: string,
    context?: SystemLogContext
  ): void {
    if (!this.initialized) return;

    const entry: SystemLogEntry = {
      timestamp: new Date().toISOString(),
      level: 'error',
      category,
      message,
    };

    if (rawData) {
      entry.rawData = rawData.length > MAX_RAW_DATA_LENGTH
        ? rawData.slice(0, MAX_RAW_DATA_LENGTH) + '...(truncated)'
        : rawData;
    }

    if (context?.requestId) {
      entry.requestId = context.requestId;
    }
    if (context?.provider) {
      entry.provider = context.provider;
    }

    const line = JSON.stringify(entry) + '\n';
    try {
      appendFileSync(this.getCurrentLogPath(), line, 'utf-8');
    } catch {
      // logging must never throw
    }
  }
}

export { SystemLogger };
