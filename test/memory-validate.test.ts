import { describe, it, expect } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serialize, type Meta } from '../src/main/memory/files'
import { commit, ensureRepo } from '../src/main/memory/store'
import { SECRET, changedFiles, problems, rollback } from '../src/main/memory/validate'

const meta: Meta = { name: 'a', type: 'project', summary: 's', sources: [], verified: '2026-09-24', used: '2026-09-24', uses: 0, stale: false, pinned: false }
const setup = async () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-val-'))
  await ensureRepo(root)
  return root
}

describe('SECRET', () => {
  it('matches real token shapes', () => {
    for (const s of [`ghp_${'a'.repeat(36)}`, `sk-ant-${'b'.repeat(40)}`, 'AKIAABCDEFGHIJKLMNOP', 'xoxb-1234567890-abc', '-----BEGIN RSA PRIVATE KEY-----'])
      expect(SECRET.test(s), s).toBe(true)
  })
  it('ignores ordinary words that share a prefix', () => {
    for (const s of ['a risk-free change', 'the task-list view', 'ask-me-anything', 'sk-short'])
      expect(SECRET.test(s), s).toBe(false)
  })
})

describe('problems', () => {
  it('accepts valid memory files in allowed places and ignores deletions', async () => {
    const root = await setup()
    mkdirSync(join(root, 'projects', 'P', 'topics'), { recursive: true })
    writeFileSync(join(root, 'topics', 'a.md'), serialize(meta, 'fine\n'))
    writeFileSync(join(root, 'projects', 'P', 'topics', 'b.md'), serialize({ ...meta, name: 'b' }, 'fine\n'))
    const files = await changedFiles(root)
    expect(files.sort()).toEqual(['projects/P/topics/b.md', 'topics/a.md'])
    expect(problems(root, [...files, 'topics/deleted.md'])).toEqual([])
  })
  it('rejects other locations, bad frontmatter, long files and secrets', async () => {
    const root = await setup()
    writeFileSync(join(root, 'notes.txt'), 'x')
    writeFileSync(join(root, 'topics', 'bad.md'), 'no frontmatter')
    writeFileSync(join(root, 'topics', 'long.md'), serialize(meta, 'x\n'.repeat(201)))
    writeFileSync(join(root, 'topics', 'key.md'), serialize(meta, `token ghp_${'a'.repeat(36)}\n`))
    const p = problems(root, await changedFiles(root))
    expect(p.some(x => x.startsWith('notes.txt'))).toBe(true)
    expect(p.some(x => x.startsWith('topics/bad.md'))).toBe(true)
    expect(p.some(x => x.startsWith('topics/long.md'))).toBe(true)
    expect(p.some(x => x.startsWith('topics/key.md'))).toBe(true)
  })
})

describe('rollback', () => {
  it('restores tracked files and removes new ones', async () => {
    const root = await setup()
    writeFileSync(join(root, 'topics', 'keep.md'), 'original')
    await commit(root, 'keep')
    writeFileSync(join(root, 'topics', 'keep.md'), 'changed')
    writeFileSync(join(root, 'topics', 'new.md'), 'new')
    writeFileSync(join(root, '.state.json'), '{}')
    await rollback(root)
    expect(readFileSync(join(root, 'topics', 'keep.md'), 'utf8')).toBe('original')
    expect(existsSync(join(root, 'topics', 'new.md'))).toBe(false)
    expect(existsSync(join(root, '.state.json'))).toBe(true) // ignored files survive
  })
})
