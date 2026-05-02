import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

export class DatabaseManager {
  private static instance: DatabaseManager | null = null;
  private db: Database.Database | null = null;
  private configDir: string;

  private constructor(configDir: string) {
    this.configDir = configDir;
  }

  static getInstance(configDir: string): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager(configDir);
    }
    return DatabaseManager.instance;
  }

  static resetInstance(): void {
    if (DatabaseManager.instance) {
      DatabaseManager.instance.close();
      DatabaseManager.instance = null;
    }
  }

  initialize(): void {
    if (this.db) return; // already initialized

    const dbPath = join(this.configDir, 'gateway.db');

    // Ensure config directory exists
    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true });
    }

    this.db = new Database(dbPath);

    // Configure for better concurrency and performance
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    // Create table and indexes
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT UNIQUE NOT NULL,
        timestamp TEXT NOT NULL,
        custom_model TEXT,
        real_model TEXT,
        provider TEXT,
        endpoint TEXT,
        status_code INTEGER,
        duration_ms INTEGER,
        is_streaming INTEGER,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        total_tokens INTEGER,
        cached_tokens INTEGER,
        user_name TEXT,
        model_group TEXT,
        actual_model TEXT,
        error_message TEXT,
        error_type TEXT,
        created_at INTEGER NOT NULL
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_timestamp ON requests(timestamp);
      CREATE INDEX IF NOT EXISTS idx_custom_model ON requests(custom_model);
      CREATE INDEX IF NOT EXISTS idx_user_name ON requests(user_name);
      CREATE INDEX IF NOT EXISTS idx_created_at ON requests(created_at);
    `);
  }

  getDb(): Database.Database {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.db;
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
