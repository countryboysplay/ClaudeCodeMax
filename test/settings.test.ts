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
  it('repairs wrong-typed split, headroom, ponytail and tab to defaults', () => {
    const f = join(dir, 'wrong-rest.json')
    writeFileSync(f, JSON.stringify({ split: null, headroom: 'false', ponytail: 1, tab: 5 }))
    expect(loadSettings(f)).toEqual(defaults())
  })
  it('repairs a non-numeric split, and a split outside [0.2, 0.8]', () => {
    const f1 = join(dir, 'split-nan.json')
    writeFileSync(f1, JSON.stringify({ split: 'abc' }))
    expect(loadSettings(f1).split).toBe(0.6)
    const f2 = join(dir, 'split-oob.json')
    writeFileSync(f2, JSON.stringify({ split: 0.9 }))
    expect(loadSettings(f2).split).toBe(0.6)
  })
  it('keeps valid split, headroom, ponytail and tab values', () => {
    const f = join(dir, 'valid-rest.json')
    writeFileSync(f, JSON.stringify({ split: 0.3, headroom: false, ponytail: false, tab: 'graph' }))
    const s = loadSettings(f)
    expect(s.split).toBe(0.3)
    expect(s.headroom).toBe(false)
    expect(s.ponytail).toBe(false)
    expect(s.tab).toBe('graph')
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

describe('memory settings', () => {
  it('defaults when missing', () =>
    expect(loadSettings(join(dir, 'none.json')).memory).toEqual({ model: 'claude-haiku-4-5-20251001', dailyCap: 30, indexCap: 60 }))
  it('keeps valid values and fills the rest', () => {
    const f = join(dir, 'mem-partial.json')
    writeFileSync(f, JSON.stringify({ memory: { dailyCap: 5 } }))
    expect(loadSettings(f).memory).toEqual({ model: 'claude-haiku-4-5-20251001', dailyCap: 5, indexCap: 60 })
  })
  it('repairs wrong types, out-of-range caps and unsafe model names', () => {
    const f = join(dir, 'mem-bad.json')
    writeFileSync(f, JSON.stringify({ memory: { model: 'haiku & del /q *', dailyCap: -1, indexCap: 2.5 } }))
    expect(loadSettings(f).memory).toEqual(defaults().memory)
    writeFileSync(f, JSON.stringify({ memory: 'nope' }))
    expect(loadSettings(f).memory).toEqual(defaults().memory)
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
