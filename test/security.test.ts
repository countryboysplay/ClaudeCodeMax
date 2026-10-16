import { describe, it, expect } from 'vitest'
import { isAllowedUrl, isInside } from '../src/main/security'

describe('isAllowedUrl', () => {
  it.each(['http://localhost:4747', 'http://localhost:4747/sessions?x=1', 'http://127.0.0.1:8787/dashboard'])('allows %s', url =>
    expect(isAllowedUrl(url)).toBe(true)
  )

  it.each([
    'https://localhost:4747',
    'http://localhost.evil.com',
    'http://127.0.0.2:4747',
    'http://example.com',
    'https://example.com',
    'javascript:alert(1)',
    'not a url',
    'file:///C:/Users/me/My%20Project/graphify-out/graph.html',
    'file://evil-host/share/graph.html'
  ])('blocks %s', url => expect(isAllowedUrl(url)).toBe(false))
})

describe('isInside', () => {
  it('accepts files inside the project', () => expect(isInside('C:/p', 'src/a.ts')).toBe(true))
  it.each(['../x', '../../x', 'C:/other/a.ts', ''])('refuses %s', f => expect(isInside('C:/p', f)).toBe(false))
})
