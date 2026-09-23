import { describe, it, expect } from 'vitest'
import { parseRegQuery, mergePath } from '../src/main/path'

const env = { USERPROFILE: 'C:\\Users\\me', APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }

describe('parseRegQuery', () => {
  it('extracts a REG_EXPAND_SZ Path value', () => {
    const out = '\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    %USERPROFILE%\\bin;C:\\Program Files\\Tools\r\n\r\n'
    expect(parseRegQuery(out)).toBe('%USERPROFILE%\\bin;C:\\Program Files\\Tools')
  })
  it('extracts a REG_SZ Path value', () => {
    expect(parseRegQuery('    Path    REG_SZ    C:\\A\r\n')).toBe('C:\\A')
  })
  it('returns empty string when there is no Path value', () => expect(parseRegQuery('ERROR: not found')).toBe(''))
})

describe('mergePath', () => {
  it('expands %VARS% case-insensitively', () => expect(mergePath(['%userprofile%\\bin'], env)).toBe('C:\\Users\\me\\bin'))
  it('leaves unknown vars untouched', () => expect(mergePath(['%NOPE%\\x'], env)).toBe('%NOPE%\\x'))
  it('dedupes case-insensitively ignoring trailing slashes, first wins', () =>
    expect(mergePath(['C:\\Tools;c:\\tools\\', 'C:\\Other'], env)).toBe('C:\\Tools;C:\\Other'))
  it('drops empty segments', () => expect(mergePath([';;C:\\A;;', ''], env)).toBe('C:\\A'))
  it('keeps drive roots intact', () => expect(mergePath(['C:\\'], env)).toBe('C:\\'))
})
