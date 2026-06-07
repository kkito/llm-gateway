import { describe, it, expect } from 'vitest';
import { requests, idxTimestamp, idxUserName, idxCustomModel, idxCreatedAt } from '../../src/lib/schema.js';

describe('requests table schema', () => {
  it('should define all expected columns', () => {
    expect(requests.id).toBeDefined();
    expect(requests.requestId).toBeDefined();
    expect(requests.timestamp).toBeDefined();
    expect(requests.createdAt).toBeDefined();
    expect(requests.userName).toBeDefined();
    expect(requests.customModel).toBeDefined();
    expect(requests.realModel).toBeDefined();
    expect(requests.provider).toBeDefined();
    expect(requests.modelGroup).toBeDefined();
    expect(requests.actualModel).toBeDefined();
    expect(requests.endpoint).toBeDefined();
    expect(requests.statusCode).toBeDefined();
    expect(requests.durationMs).toBeDefined();
    expect(requests.isStreaming).toBeDefined();
    expect(requests.promptTokens).toBeDefined();
    expect(requests.completionTokens).toBeDefined();
    expect(requests.totalTokens).toBeDefined();
    expect(requests.cachedTokens).toBeDefined();
    expect(requests.errorMessage).toBeDefined();
    expect(requests.errorType).toBeDefined();
    expect(requests.responseMetadata).toBeDefined();
  });

  it('should export all four indexes', () => {
    expect(idxTimestamp).toBeDefined();
    expect(idxUserName).toBeDefined();
    expect(idxCustomModel).toBeDefined();
    expect(idxCreatedAt).toBeDefined();
  });

  it('should have correct column types', () => {
    // Verify id is Autoincrement primary key
    expect(requests.id.primary).toBe(true);
    expect(requests.id.notNull).toBe(true);
    // Verify request_id is unique and not null
    expect(requests.requestId.isUnique).toBe(true);
    expect(requests.requestId.notNull).toBe(true);
  });
});
