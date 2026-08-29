import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import * as schema from './schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class DatabaseManager {
  private static instance: DatabaseManager | null = null;
  private db: Database.Database | null = null;
  private _drizzle: ReturnType<typeof drizzle> | null = null;
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

  static getExistingInstance(): DatabaseManager | null {
    return DatabaseManager.instance;
  }

  initialize(): void {
    if (this.db) return;

    const dbPath = join(this.configDir, 'gateway.db');

    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    this._drizzle = drizzle(this.db, { schema });

    const migrationsFolder = join(__dirname, '..', '..', 'migrations');
    if (existsSync(migrationsFolder)) {
      try {
        migrate(this._drizzle, { migrationsFolder });
      } catch (err: any) {
        // 兼容线上已存在但无 __drizzle_migrations 记录的老库：migrate 因 "table already exists" 失败
        const msg: string = err?.cause?.message ?? err?.message ?? String(err);
        const isAlreadyExists = msg.includes('already exists');
        if (!isAlreadyExists) throw err;
        console.warn(`[DB] migrate failed (${msg}), falling back to ensure columns`);
        this.ensureColumns();
        // 标记已有迁移已执行，避免下次仍走失败路径
        try {
          const applied = this.db!.prepare(`SELECT count(*) as c FROM "__drizzle_migrations"`).get() as { c: number } | undefined;
          if (!applied || applied.c === 0) {
            this.db!.exec(`CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`);
            const now = Date.now();
            this.db!.prepare(`INSERT OR IGNORE INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)`).run('0000_furry_loa', now);
            this.db!.prepare(`INSERT OR IGNORE INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)`).run('0001_melodic_gambit', now);
          }
        } catch {
          // ignore bookkeeping failure
        }
      }
    } else {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          request_id TEXT NOT NULL UNIQUE,
          timestamp TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          user_name TEXT,
          custom_model TEXT,
          real_model TEXT,
          provider TEXT,
          model_group TEXT,
          actual_model TEXT,
          endpoint TEXT,
          status_code INTEGER,
          duration_ms INTEGER,
          is_streaming INTEGER,
          ttft_ms INTEGER,
          tps REAL,
          prompt_tokens INTEGER,
          completion_tokens INTEGER,
          total_tokens INTEGER,
          cached_tokens INTEGER,
          error_message TEXT,
          error_type TEXT,
          response_metadata TEXT
        )
      `);
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_timestamp ON requests(timestamp);
        CREATE INDEX IF NOT EXISTS idx_user_name ON requests(user_name);
        CREATE INDEX IF NOT EXISTS idx_custom_model ON requests(custom_model);
        CREATE INDEX IF NOT EXISTS idx_created_at ON requests(created_at);
      `);
    }
  }

  private ensureColumns(): void {
    if (!this.db) return;
    try {
      const cols = this.db.prepare('PRAGMA table_info(requests)').all() as Array<{ name: string }>;
      const names = new Set(cols.map(c => c.name));
      if (!names.has('ttft_ms')) this.db.exec('ALTER TABLE requests ADD COLUMN ttft_ms INTEGER');
      if (!names.has('tps')) this.db.exec('ALTER TABLE requests ADD COLUMN tps REAL');
    } catch {
      // ignore
    }
  }

  getDb(): Database.Database {
    if (!this.db) throw new Error('Database not initialized. Call initialize() first.');
    return this.db;
  }

  getDrizzle(): ReturnType<typeof drizzle> {
    if (!this._drizzle) throw new Error('Database not initialized. Call initialize() first.');
    return this._drizzle;
  }

  cleanupOldRequests(retentionDays: number = 90): void {
    if (!this.db) return;
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const result = this.db.prepare('DELETE FROM requests WHERE created_at < ?').run(cutoff);
    if (result.changes > 0) {
      console.log(`[DB] Cleaned ${result.changes} request records older than ${retentionDays} days`);
    }
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this._drizzle = null;
    }
  }
}
