import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaults, loadSettings, saveSettings, addRecent } from '../src/main/settings'

const dir = mkdtempSync(join(tmpdir(), 'ccm-settings-'))

describe('loadSettings', () => {
  it('returns defaults when the file is missing', () => expect(loadSettings(join(dir, 'none.json'))).toEqual(defaults()))
  it('returns defaults when the file is corrupt', () => {
    const f = join(dir, 'corrupt.json')
    writeFileSync(f, '{not json')
    expect(loadSettings(f)).toEqual(defaults())
  })
  it('repairs wrong-typed fields', () => {
    const f = join(dir, 'wrong.json')
    writeFileSync(f, JSON.stringify({ recent: 'C:\\x', skipped: null, headroom: false }))
    const s = loadSettings(f)
    expect(s.recent).toEqual([])
    expect(s.skipped).toEqual([])
    expect(s.headroom).toBe(false)
  })
  it('does not share arrays between loads', () => {
    const a = loadSettings(join(dir, 'none.json'))
    a.skipped.push('uv')
    expect(loadSettings(join(dir, 'none.json')).skipped).toEqual([])
  })
  it('round-trips and creates missing folders', () => {
    const f = join(dir, 'nested', 'settings.json')
    saveSettings(f, { ...defaults(), headroom: false, recent: ['C:\\a b'] })
    expect(loadSettings(f)).toMatchObject({ headroom: false, recent: ['C:\\a b'] })
  })
})

describe('addRecent', () => {
  it('moves an existing entry to the front, case-insensitively', () =>
    expect(addRecent(['C:\\A', 'C:\\B'], 'c:\\b')).toEqual(['c:\\b', 'C:\\A']))
  it('caps the list at 10', () => {
    const list = Array.from({ length: 10 }, (_, i) => `C:\\p${i}`)
    const out = addRecent(list, 'C:\\new')
    expect(out).toHaveLength(10)
    expect(out[0]).toBe('C:\\new')
    expect(out).not.toContain('C:\\p9')
  })
})
