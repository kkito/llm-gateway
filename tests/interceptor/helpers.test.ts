import { describe, it, expect } from 'vitest'
import { isAnthropicV1Messages } from '../../src/interceptor/helpers.js'

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
