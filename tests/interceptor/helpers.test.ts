import { describe, it, expect } from 'vitest'
import { isAnthropicV1Messages, isAnthropicEndpoint } from '../../src/interceptor/helpers.js'

describe('isAnthropicV1Messages', () => {
  it('should return true for /v1/messages URL', () => {
    expect(isAnthropicV1Messages('https://api.anthropic.com/v1/messages')).toBe(true)
  })

  it('should return true for /v1/messages URL with trailing slash', () => {
    expect(isAnthropicV1Messages('https://api.anthropic.com/v1/messages/')).toBe(true)
  })

  it('should return true for /v1/messages URL with query params', () => {
    expect(isAnthropicV1Messages('https://api.anthropic.com/v1/messages?model=claude')).toBe(true)
  })

  it('should return false for /v1/chat/completions URL', () => {
    expect(isAnthropicV1Messages('https://api.openai.com/v1/chat/completions')).toBe(false)
  })

  it('should return false for unrelated URL', () => {
    expect(isAnthropicV1Messages('https://api.example.com/v1/other')).toBe(false)
  })

  it('should handle edge case of empty string', () => {
    expect(isAnthropicV1Messages('')).toBe(false)
  })
})

describe('isAnthropicEndpoint', () => {
  it('should return true for /v1/messages', () => {
    expect(isAnthropicEndpoint('/v1/messages')).toBe(true)
  })

  it('should return true for /messages', () => {
    expect(isAnthropicEndpoint('/messages')).toBe(true)
  })

  it('should return true for /v1/v1/messages', () => {
    expect(isAnthropicEndpoint('/v1/v1/messages')).toBe(true)
  })

  it('should return false for /v1/chat/completions', () => {
    expect(isAnthropicEndpoint('/v1/chat/completions')).toBe(false)
  })

  it('should return false for /chat/completions', () => {
    expect(isAnthropicEndpoint('/chat/completions')).toBe(false)
  })

  it('should return false for undefined', () => {
    expect(isAnthropicEndpoint(undefined)).toBe(false)
  })

  it('should return false for empty string', () => {
    expect(isAnthropicEndpoint('')).toBe(false)
  })
})
