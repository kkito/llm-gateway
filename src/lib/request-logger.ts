import type { DatabaseManager } from './db.js';
import { requests } from './schema.js';

const FLUSH_INTERVAL_MS = 100;
const MAX_QUEUE_SIZE = 500;

export interface RequestLogEntry {
  requestId: string;
  timestamp: string;
  userName?: string;
  customModel?: string;
  realModel?: string;
  provider?: string;
  endpoint: string;
  statusCode: number;
  durationMs: number;
  isStreaming: boolean;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  modelGroup?: string;
  actualModel?: string;
  errorMessage?: string;
  errorType?: string;
  responseMetadata?: string;
}

export class RequestLogger {
  private static instance: RequestLogger | null = null;
  private dbManager: DatabaseManager;
  private queue: RequestLogEntry[] = [];
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
    this.intervalId = setInterval(() => this.flushQueue(), FLUSH_INTERVAL_MS);
  }

  log(entry: RequestLogEntry): void {
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      this.queue.shift();
      console.warn(`[RequestLogger] Queue full (${MAX_QUEUE_SIZE}), dropping oldest entry`);
    }
    this.queue.push(entry);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.flushQueue();
  }

  private flushQueue(): void {
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.queue.length);
    this.writeBatch(batch);
  }

  private writeBatch(entries: RequestLogEntry[]): void {
    try {
      const seen = new Map<string, RequestLogEntry>();
      for (const e of entries) {
        seen.set(e.requestId, e);
      }
      const unique = Array.from(seen.values());

      const drizzle = this.dbManager.getDrizzle();
      drizzle.insert(requests).values(
        unique.map(e => ({
          requestId: e.requestId,
          timestamp: e.timestamp,
          createdAt: Date.now(),
          userName: e.userName ?? null,
          customModel: e.customModel ?? null,
          realModel: e.realModel ?? null,
          provider: e.provider ?? null,
          modelGroup: e.modelGroup ?? null,
          actualModel: e.actualModel ?? null,
          endpoint: e.endpoint,
          statusCode: e.statusCode,
          durationMs: e.durationMs,
          isStreaming: e.isStreaming,
          promptTokens: e.promptTokens ?? null,
          completionTokens: e.completionTokens ?? null,
          totalTokens: e.totalTokens ?? null,
          cachedTokens: e.cachedTokens ?? null,
          errorMessage: e.errorMessage ?? null,
          errorType: e.errorType ?? null,
          responseMetadata: e.responseMetadata ?? null,
        }))
      ).run();
    } catch (err: any) {
      if (err.message && err.message.includes('UNIQUE constraint')) {
        this.writeBatchIndividually(entries);
      } else {
        console.error(`[RequestLogger] Batch write failed: ${err.message}`);
      }
    }
  }

  private writeBatchIndividually(entries: RequestLogEntry[]): void {
    const db = this.dbManager.getDb();
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO requests (
        request_id, timestamp, created_at,
        user_name, custom_model, real_model, provider,
        model_group, actual_model,
        endpoint, status_code, duration_ms, is_streaming,
        prompt_tokens, completion_tokens, total_tokens, cached_tokens,
        error_message, error_type, response_metadata
      ) VALUES (
        @requestId, @timestamp, @createdAt,
        @userName, @customModel, @realModel, @provider,
        @modelGroup, @actualModel,
        @endpoint, @statusCode, @durationMs, @isStreaming,
        @promptTokens, @completionTokens, @totalTokens, @cachedTokens,
        @errorMessage, @errorType, @responseMetadata
      )
    `);
    const insertMany = db.transaction((rows: Record<string, any>[]) => {
      for (const row of rows) {
        stmt.run(row);
      }
    });
    try {
      insertMany(
        entries.map(e => ({
          requestId: e.requestId,
          timestamp: e.timestamp,
          createdAt: Date.now(),
          userName: e.userName ?? null,
          customModel: e.customModel ?? null,
          realModel: e.realModel ?? null,
          provider: e.provider ?? null,
          modelGroup: e.modelGroup ?? null,
          actualModel: e.actualModel ?? null,
          endpoint: e.endpoint,
          statusCode: e.statusCode,
          durationMs: e.durationMs,
          isStreaming: e.isStreaming ? 1 : 0,
          promptTokens: e.promptTokens ?? null,
          completionTokens: e.completionTokens ?? null,
          totalTokens: e.totalTokens ?? null,
          cachedTokens: e.cachedTokens ?? null,
          errorMessage: e.errorMessage ?? null,
          errorType: e.errorType ?? null,
          responseMetadata: e.responseMetadata ?? null,
        }))
      );
    } catch (err: any) {
      console.error(`[RequestLogger] Batch write failed: ${err.message}`);
    }
  }
}
