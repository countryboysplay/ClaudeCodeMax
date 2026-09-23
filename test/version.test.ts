import { describe, it, expect } from 'vitest'
import { parseVersion, atLeast } from '../src/main/version'

describe('parseVersion', () => {
  it('reads node style versions', () => expect(parseVersion('v22.13.0')).toEqual([22, 13, 0]))
  it('reads versions embedded in text', () => expect(parseVersion('2.1.3 (Claude Code)')).toEqual([2, 1, 3]))
  it('returns null for garbage', () => expect(parseVersion('not installed')).toBeNull())
})

describe('atLeast', () => {
  it('accepts an exact match', () => expect(atLeast('v22.13.0', '22.13.0')).toBe(true))
  it('compares numerically, not as strings', () => expect(atLeast('v22.9.0', '22.13.0')).toBe(false))
  it('accepts newer majors', () => expect(atLeast('v24.1.0', '22.13.0')).toBe(true))
  it('rejects older patch', () => expect(atLeast('v22.12.9', '22.13.0')).toBe(false))
  it('rejects unparseable input', () => expect(atLeast('', '22.13.0')).toBe(false))
})
