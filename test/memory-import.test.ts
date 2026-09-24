import { describe, it, expect } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readMemory, today } from '../src/main/memory/files'
import { importAutoMemory } from '../src/main/memory/import'

const OLD = new Date('2026-08-01')

function claudeHome() {
  const cp = mkdtempSync(join(tmpdir(), 'ccm-cp-'))
  const mem = join(cp, 'C--code-app', 'memory')
  mkdirSync(mem, { recursive: true })
  writeFileSync(join(mem, 'MEMORY.md'), '- [x](x.md)')
  writeFileSync(join(mem, 'prefers-short.md'), '---\nname: prefers-short\ndescription: likes terse answers\nmetadata:\n  type: feedback\n---\nKeep it short.\n')
  writeFileSync(join(mem, 'plain.md'), '\nRelease on Fridays.\nMore.\n')
  // Backdated, like a file migrated from an old auto-memory folder: `used` must not inherit this age.
  utimesSync(join(mem, 'prefers-short.md'), OLD, OLD)
  mkdirSync(join(cp, 'SKIP', 'memory'), { recursive: true })
  writeFileSync(join(cp, 'SKIP', 'memory', 'z.md'), 'z')
  return cp
}

describe('importAutoMemory', () => {
  it('converts auto-memory files into project memories, once', () => {
    const cp = claudeHome()
    const root = mkdtempSync(join(tmpdir(), 'ccm-mem-'))
    expect(importAutoMemory(root, cp, 'SKIP')).toBe(2)
    const a = readMemory(join(root, 'projects', 'C--code-app', 'topics', 'prefers-short.md'))!
    expect(a.meta).toMatchObject({ name: 'prefers-short', type: 'feedback', summary: 'likes terse answers', sources: [] })
    expect(a.body).toBe('Keep it short.\n')
    expect(a.meta.verified).toBe('2026-08-01') // verified still tracks the source file's mtime
    expect(a.meta.used).toBe(today()) // but used gets a fresh 30-day grace period, not the mtime
    const b = readMemory(join(root, 'projects', 'C--code-app', 'topics', 'plain.md'))!
    expect(b.meta).toMatchObject({ name: 'plain', type: 'project', summary: 'Release on Fridays.' })
    expect(existsSync(join(root, 'projects', 'C--code-app', 'topics', 'MEMORY.md'))).toBe(false)
    expect(existsSync(join(root, 'projects', 'SKIP'))).toBe(false)
    expect(importAutoMemory(root, cp, 'SKIP')).toBe(0)
  })
  it('does nothing when ~/.claude/projects is missing', () =>
    expect(importAutoMemory(mkdtempSync(join(tmpdir(), 'ccm-mem-')), 'C:\\no\\such', 'x')).toBe(0))
})
