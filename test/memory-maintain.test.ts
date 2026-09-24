import { describe, it, expect } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readMemory, writeMemory, writeProject, type Meta } from '../src/main/memory/files'
import { archive, checkSources, promote, recordUse, splitSource, stampSources } from '../src/main/memory/maintain'
import { git } from '../src/main/memory/store'

const DAY = '2026-09-24'
const meta = (over: Partial<Meta> = {}): Meta => ({
  name: 'a', type: 'project', summary: 's', sources: [], verified: '2026-09-20', used: '2026-09-20', uses: 0, stale: false, pinned: false, ...over
})
const fresh = (p: string) => mkdtempSync(join(tmpdir(), p))
const gitc = (cwd: string, ...a: string[]) => git(cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a)

async function projectRepo() {
  const dir = fresh('ccm-proj-')
  await git(dir, 'init', '-q')
  writeFileSync(join(dir, 'app.ts'), 'v1')
  await gitc(dir, 'add', '-A')
  await gitc(dir, 'commit', '-q', '-m', 'v1')
  return dir
}

describe('splitSource', () => {
  it('splits a trailing hash only', () => {
    expect(splitSource('src/a.ts@abc1234')).toEqual(['src/a.ts', 'abc1234'])
    expect(splitSource('node_modules/@lydell/x.js')).toEqual(['node_modules/@lydell/x.js', ''])
  })
})

describe('recordUse', () => {
  it('bumps used and uses for memory files that were read, once per slice', () => {
    const root = fresh('ccm-m-')
    const f = join(root, 'topics', 'a.md')
    writeMemory({ file: f, meta: meta(), body: '' })
    expect(recordUse(root, [f, f, 'C:\\elsewhere\\x.md'], DAY)).toBe(1)
    expect(readMemory(f)!.meta).toMatchObject({ used: DAY, uses: 1 })
  })
})

describe('promote', () => {
  it('moves user and feedback memories to global, keeping the newer copy', () => {
    const root = fresh('ccm-m-')
    writeMemory({ file: join(root, 'projects', 'P', 'topics', 'pref.md'), meta: meta({ name: 'pref', type: 'feedback', verified: '2026-09-22' }), body: 'new' })
    writeMemory({ file: join(root, 'topics', 'pref.md'), meta: meta({ name: 'pref', type: 'feedback', verified: '2026-09-01' }), body: 'old' })
    writeMemory({ file: join(root, 'projects', 'P', 'topics', 'fact.md'), meta: meta({ name: 'fact' }), body: '' })
    expect(promote(root)).toBe(1)
    expect(readMemory(join(root, 'topics', 'pref.md'))!.body).toBe('new')
    expect(existsSync(join(root, 'projects', 'P', 'topics', 'pref.md'))).toBe(false)
    expect(existsSync(join(root, 'projects', 'P', 'topics', 'fact.md'))).toBe(true)
  })
})

describe('archive', () => {
  it('moves memories unused for over 90 days, except exempt ones', () => {
    const root = fresh('ccm-m-')
    writeMemory({ file: join(root, 'topics', 'old.md'), meta: meta({ name: 'old', used: '2026-06-01' }), body: '' })
    writeMemory({ file: join(root, 'topics', 'me.md'), meta: meta({ name: 'me', type: 'user', used: '2026-01-01' }), body: '' })
    expect(archive(root, DAY)).toBe(1)
    expect(existsSync(join(root, 'archive', 'topics', 'old.md'))).toBe(true)
    expect(existsSync(join(root, 'topics', 'me.md'))).toBe(true)
  })
})

describe('sources', () => {
  it('stamps hashes, then flags changed and deleted sources once', async () => {
    const proj = await projectRepo()
    const root = fresh('ccm-m-')
    writeProject(root, 'P', proj)
    const f = join(root, 'projects', 'P', 'topics', 'a.md')
    writeMemory({ file: f, meta: meta({ sources: ['app.ts'] }), body: '' })
    await stampSources(root, 'P', proj)
    expect(readMemory(f)!.meta.sources[0]).toMatch(/^app\.ts@[0-9a-f]{7,}$/)
    expect(await checkSources(root)).toEqual([])

    writeFileSync(join(proj, 'app.ts'), 'v2')
    await gitc(proj, 'commit', '-qam', 'v2')
    expect(await checkSources(root)).toEqual([f])
    expect(readMemory(f)!.meta.stale).toBe(true)
    expect(await checkSources(root)).toEqual([]) // already stale, not re-queued

    const g = join(root, 'projects', 'P', 'topics', 'b.md')
    writeMemory({ file: g, meta: meta({ name: 'b', sources: ['gone.ts@abc1234'] }), body: '' })
    expect(await checkSources(root)).toEqual([g])
  })
  it('skips projects whose folder is missing on this machine', async () => {
    const root = fresh('ccm-m-')
    writeProject(root, 'P', 'C:\\no\\such\\dir')
    writeMemory({ file: join(root, 'projects', 'P', 'topics', 'a.md'), meta: meta({ sources: ['x@abc1234'] }), body: '' })
    expect(await checkSources(root)).toEqual([])
    rmSync(root, { recursive: true, force: true })
  })
  it('does not flag unhashed sources in a project that is not git-tracked', async () => {
    const proj = fresh('ccm-nogit-')
    const root = fresh('ccm-m-')
    writeProject(root, 'P', proj)
    const f = join(root, 'projects', 'P', 'topics', 'a.md')
    writeMemory({ file: f, meta: meta({ sources: ['missing.ts'] }), body: '' })
    expect(await checkSources(root)).toEqual([])
    expect(readMemory(f)!.meta.stale).toBe(false)
  })
})
