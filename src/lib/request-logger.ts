import type { DatabaseManager } from './db.js';
import type { LogEntry } from '../logger.js';

const FLUSH_INTERVAL_MS = 100;
const MAX_QUEUE_SIZE = 500;

export class RequestLogger {
  private static instance: RequestLogger | null = null;
  private dbManager: DatabaseManager;
  private queue: LogEntry[] = [];
  private intervalId: ReturnType<typeof setInterval> | null = null;

  private constructor(dbManager: DatabaseManager) {
    this.dbManager = dbManager;
  }

  static getInstance(dbManager: DatabaseManager): RequestLogger {
    if (!RequestLogger.instance) {
      RequestLogger.instance = new RequestLogger(dbManager);
    }
    return RequestLogger.instance;
  }

  static resetInstance(): void {
    if (RequestLogger.instance) {
      RequestLogger.instance.stop();
      RequestLogger.instance = null;
    }
  }

  start(): void {
    if (this.intervalId) return;

    this.intervalId = setInterval(() => {
      this.flushQueue();
    }, FLUSH_INTERVAL_MS);
  }

  log(entry: LogEntry): void {
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      // Queue full — drop oldest and warn
      this.queue.shift();
      console.warn(`[RequestLogger] 队列已满 (${MAX_QUEUE_SIZE}), 丢弃最旧的日志条目`);
    }
    this.queue.push(entry);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    // Flush remaining entries synchronously
    this.flushQueue();
  }

  private flushQueue(): void {
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0, this.queue.length);
    this.writeBatch(batch);
  }

  private writeBatch(entries: LogEntry[]): void {
    const db = this.dbManager.getDb();

    const stmt = db.prepare(`
      INSERT OR IGNORE INTO requests (
        request_id, timestamp, custom_model, real_model, provider,
        endpoint, status_code, duration_ms, is_streaming,
        prompt_tokens, completion_tokens, total_tokens, cached_tokens,
        user_name, model_group, actual_model, error_message, error_type,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((batch: LogEntry[]) => {
      for (const entry of batch) {
        stmt.run(
          entry.requestId,
          entry.timestamp,
          entry.customModel,
          entry.realModel,
          entry.provider,
          entry.endpoint,
          entry.statusCode,
          entry.durationMs,
          entry.isStreaming ? 1 : 0,
          entry.promptTokens ?? null,
          entry.completionTokens ?? null,
          entry.totalTokens ?? null,
          entry.cachedTokens ?? null,
          entry.userName ?? null,
          entry.modelGroup ?? null,
          entry.actualModel ?? null,
          entry.error?.message ?? null,
          entry.error?.type ?? null,
          Date.now()
        );
      }
    });

    try {
      insertMany(entries);
    } catch (err: any) {
      console.error(`[RequestLogger] 批量写入失败: ${err.message}`);
    }
  }
}
