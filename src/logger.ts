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
  isStreaming?: boolean;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  userName?: string;
  modelGroup?: string;       // 新增：请求的模型组名
  actualModel?: string;      // 新增：实际使用的模型
  triedModels?: Array<{      // 新增：尝试过的模型列表
    model: string;
    exceeded: boolean;
    message?: string;
  }>;
  error?: {
    message: string;
    type?: string;
  };
}

export class Logger {
  private logDir: string;
  private customFilename?: string; // 当提供自定义文件名时使用（主要用于测试）

  constructor(
    logDir: string,
    customFilename?: string
  ) {
    this.logDir = logDir;
    this.customFilename = customFilename;
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
  }

  /**
   * 获取当前日期的日志文件路径
   * 如果指定了自定义文件名（如测试中），使用自定义文件名
   * 否则动态生成当天的文件名
   */
  private getCurrentLogPath(): string {
    let filename: string;
    if (this.customFilename) {
      filename = this.customFilename;
    } else {
      filename = `proxy-${new Date().toISOString().split('T')[0]}.log`;
    }
    return join(this.logDir, filename);
  }

  getFilePath(): string {
    return this.getCurrentLogPath();
  }

  log(entry: LogEntry): void {
    const line = JSON.stringify(entry) + '\n';
    appendFileSync(this.getCurrentLogPath(), line, 'utf-8');
  }
}
