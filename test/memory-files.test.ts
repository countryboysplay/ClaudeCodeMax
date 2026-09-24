import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  allMemories, daysBetween, listMemories, parseFrontmatter, projectPath, readMemory, serialize, slugFor,
  toMeta, writeMemory, writeProject, type Meta
} from '../src/main/memory/files'

const meta = (over: Partial<Meta> = {}): Meta => ({
  name: 'release-flow', type: 'project', summary: 'tag v* then publish', sources: ['a.ts@abc1234'],
  verified: '2026-09-24', used: '2026-09-24', uses: 3, stale: false, pinned: false, ...over
})

describe('slugFor', () => {
  it('matches Claude Code project folder names', () =>
    expect(slugFor('C:\\Users\\jonat\\OneDrive\\Desktop\\Claude Terminal')).toBe('C--Users-jonat-OneDrive-Desktop-Claude-Terminal'))
})

describe('daysBetween', () => {
  it('counts whole days', () => expect(daysBetween('2026-09-01', '2026-09-24')).toBe(23))
})

describe('frontmatter', () => {
  it('round-trips through serialize and parse', () => {
    const text = serialize(meta(), 'Body line\n')
    const p = parseFrontmatter(text)!
    expect(toMeta(p.raw)).toEqual(meta())
    expect(p.body).toBe('Body line\n')
  })
  it('parses CRLF files', () => {
    const p = parseFrontmatter(serialize(meta(), 'x\n').replace(/\n/g, '\r\n'))!
    expect(toMeta(p.raw)?.name).toBe('release-flow')
  })
  it('returns null without frontmatter', () => expect(parseFrontmatter('just text')).toBeNull())
  it('rejects a missing summary or an unknown type', () => {
    expect(toMeta({ name: 'a', type: 'project', verified: '2026-09-24' })).toBeNull()
    expect(toMeta({ name: 'a', type: 'nope', summary: 's', verified: '2026-09-24' })).toBeNull()
  })
  it('fills defaults for optional fields', () =>
    expect(toMeta({ name: 'a', type: 'user', summary: 's', verified: '2026-09-01' })).toEqual({
      name: 'a', type: 'user', summary: 's', sources: [], verified: '2026-09-01', used: '2026-09-01',
      uses: 0, stale: false, pinned: false
    }))
  it('reads an empty list as []', () => expect(parseFrontmatter('---\nsources: []\n---\n')!.raw.sources).toEqual([]))
})

describe('listing', () => {
  it('reads user.md and topics, skipping invalid files', () => {
    const root = mkdtempSync(join(tmpdir(), 'ccm-mem-'))
    writeMemory({ file: join(root, 'user.md'), meta: meta({ name: 'user', type: 'user' }), body: '' })
    writeMemory({ file: join(root, 'topics', 'a.md'), meta: meta({ name: 'a' }), body: '' })
    writeFileSync(join(root, 'topics', 'broken.md'), 'no frontmatter')
    writeMemory({ file: join(root, 'projects', 'P', 'topics', 'b.md'), meta: meta({ name: 'b' }), body: '' })
    expect(listMemories(root).map(m => m.meta.name).sort()).toEqual(['a', 'user'])
    expect(allMemories(root).map(m => m.meta.name).sort()).toEqual(['a', 'b', 'user'])
    expect(readMemory(join(root, 'topics', 'missing.md'))).toBeNull()
  })
  it('stores and reads project.json', () => {
    const root = mkdtempSync(join(tmpdir(), 'ccm-mem-'))
    mkdirSync(join(root, 'projects'), { recursive: true })
    expect(projectPath(root, 'P')).toBeNull()
    writeProject(root, 'P', 'C:\\code\\p')
    expect(projectPath(root, 'P')).toBe('C:\\code\\p')
  })
})
