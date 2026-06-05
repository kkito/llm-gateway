import { describe, it, expect } from 'vitest'
import { UserFormPage } from '../../../src/admin/views/user-form.js'
import type { UserApiKey } from '../../../src/config.js'

const mockModels = [
  { customModel: 'gpt-4', realModel: 'gpt-4', desc: 'OpenAI GPT-4' },
  { customModel: 'claude-3', realModel: 'claude-3-opus', desc: 'Anthropic Claude 3' },
  { customModel: 'gemini-pro', realModel: 'gemini-1.5-pro', desc: 'Google Gemini' },
]

describe('UserFormPage', () => {
  it('should render name input', () => {
    const html = UserFormPage({ mode: 'new', models: mockModels }).toString()
    expect(html).toContain('name="name"')
    expect(html).toContain('用户名称')
  })

  it('should render model checkboxes when models prop is provided', () => {
    const html = UserFormPage({ mode: 'new', models: mockModels }).toString()
    expect(html).toContain('模型权限')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('name="allowedModels"')
    expect(html).toContain('gpt-4')
    expect(html).toContain('claude-3')
    expect(html).toContain('gemini-pro')
  })

  it('should not render model section when models prop is empty', () => {
    const html = UserFormPage({ mode: 'new', models: [] }).toString()
    expect(html).not.toContain('模型权限')
  })

  it('should check allowedModels checkboxes in edit mode', () => {
    const user: UserApiKey = {
      name: 'Alice',
      apikey: 'sk-lg-test',
      allowedModels: ['gpt-4', 'gemini-pro'],
    }
    const html = UserFormPage({ mode: 'edit', user, models: mockModels }).toString()
    expect(html).toContain('value="gpt-4" checked')
    expect(html).toContain('value="gemini-pro" checked')
    expect(html).toContain('value="claude-3"')
    expect(html).not.toContain('value="claude-3" checked')
  })

  it('should show API key in edit mode', () => {
    const user: UserApiKey = {
      name: 'Alice',
      apikey: 'sk-lg-secret-key',
    }
    const html = UserFormPage({ mode: 'edit', user, models: mockModels }).toString()
    expect(html).toContain('sk-lg-secret-key')
    expect(html).toContain('API Key 不可修改')
  })
})
