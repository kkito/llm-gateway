import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

export interface LogEntry {
  timestamp: string;
  requestId: string;
  customModel: string;
  realModel?: string;
  provider?: string;
  endpoint: string;
  method: string;
  statusCode: number;
  durationMs: number;
  isStreaming: boolean;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  userName?: string;  // 新增：用户名称
  error?: {
    message: string;
    type?: string;
  };
}

export class Logger {
  private logFilePath: string;

  constructor(
    private logDir: string,
    private filename: string = `proxy-${new Date().toISOString().split('T')[0]}.log`
  ) {
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
    this.logFilePath = join(logDir, filename);
  }

  log(entry: LogEntry): void {
    const line = JSON.stringify(entry) + '\n';
    appendFileSync(this.logFilePath, line, 'utf-8');
  }

  getFilePath(): string {
    return this.logFilePath;
  }
}
