import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeMemory, type Memory, type Meta } from '../src/main/memory/files'
import { isDecayed, rebuildIndexes, renderIndex, splitCap } from '../src/main/memory/indexes'

const root = 'C:\\mem'
const mem = (name: string, over: Partial<Meta> = {}, file = join(root, 'topics', `${name}.md`)): Memory => ({
  file,
  body: '',
  meta: { name, type: 'project', summary: `about ${name}`, sources: [], verified: '2026-09-20', used: '2026-09-20', uses: 0, stale: false, pinned: false, ...over }
})
const DAY = '2026-09-24'

describe('renderIndex', () => {
  it('orders pinned, then user/feedback, then most recently used', () => {
    const out = renderIndex(root, [
      mem('old', { used: '2026-09-01' }),
      mem('new', { used: '2026-09-23' }),
      mem('pref', { type: 'feedback', used: '2026-08-01' }),
      mem('pin', { pinned: true, used: '2026-08-01' })
    ], 10, DAY)
    expect(out.split('\n').filter(Boolean).map(l => /\[(.+?)\]/.exec(l)![1])).toEqual(['pin', 'pref', 'new', 'old'])
  })
  it('writes forward-slash paths relative to the memory root, and flags stale entries', () => {
    const out = renderIndex(root, [mem('a', { stale: true }, join(root, 'projects', 'P', 'topics', 'a.md'))], 10, DAY)
    expect(out).toBe('- [a](projects/P/topics/a.md) — about a (may be stale)\n')
  })
  it('applies the cap', () => {
    const out = renderIndex(root, ['a', 'b', 'c'].map(n => mem(n)), 2, DAY)
    expect(out.trim().split('\n')).toHaveLength(2)
  })
  it('omits decayed entries but keeps exempt ones', () => {
    const out = renderIndex(root, [mem('gone', { used: '2026-08-01' }), mem('me', { type: 'user', used: '2026-01-01' })], 10, DAY)
    expect(out).not.toContain('gone')
    expect(out).toContain('me')
  })
  it('is empty when there is nothing to show', () => expect(renderIndex(root, [], 10, DAY)).toBe(''))
})

describe('isDecayed and splitCap', () => {
  it('decays after 30 unused days', () => {
    expect(isDecayed(mem('a', { used: '2026-08-25' }).meta, DAY)).toBe(false)
    expect(isDecayed(mem('a', { used: '2026-08-24' }).meta, DAY)).toBe(true)
  })
  it('splits the cap 40/60 between global and project', () => expect(splitCap(60)).toEqual({ global: 24, project: 36 }))
})

describe('rebuildIndexes', () => {
  it('writes the global and per-project INDEX.md files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ccm-idx-'))
    writeMemory(mem('g', {}, join(dir, 'topics', 'g.md')))
    writeMemory(mem('p', {}, join(dir, 'projects', 'P', 'topics', 'p.md')))
    rebuildIndexes(dir, 60, DAY)
    expect(readFileSync(join(dir, 'INDEX.md'), 'utf8')).toContain('[g](topics/g.md)')
    expect(readFileSync(join(dir, 'projects', 'P', 'INDEX.md'), 'utf8')).toContain('[p](projects/P/topics/p.md)')
  })
})
