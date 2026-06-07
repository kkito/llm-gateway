import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const requests = sqliteTable('requests', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  requestId: text('request_id').notNull().unique(),
  timestamp: text('timestamp').notNull(),
  createdAt: integer('created_at').notNull(),

  userName: text('user_name'),

  customModel: text('custom_model'),
  realModel: text('real_model'),
  provider: text('provider'),
  modelGroup: text('model_group'),
  actualModel: text('actual_model'),

  endpoint: text('endpoint'),
  statusCode: integer('status_code'),
  durationMs: integer('duration_ms'),
  isStreaming: integer('is_streaming', { mode: 'boolean' }),

  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  totalTokens: integer('total_tokens'),
  cachedTokens: integer('cached_tokens'),

  errorMessage: text('error_message'),
  errorType: text('error_type'),

  responseMetadata: text('response_metadata'),
});
