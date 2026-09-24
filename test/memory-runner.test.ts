import { afterEach, describe, it, expect } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { readMemory, slugFor, writeMemory, writeProject } from '../src/main/memory/files'
import { MemoryRunner } from '../src/main/memory/runner'
import { enqueue, git, readQueue, readState } from '../src/main/memory/store'

const DAY = '2026-09-24'
const fake = `node "${resolve('test/fixtures/fake-distiller.mjs')}"`
const runners: MemoryRunner[] = []
afterEach(() => {
  for (const r of runners.splice(0)) r.stop()
  for (const k of ['CCM_FAKE_LOG', 'CCM_FAKE_FAIL', 'CCM_FAKE_SECRET', 'CCM_FAKE_VERDICT']) delete process.env[k]
})

function world() {
  const base = mkdtempSync(join(tmpdir(), 'ccm-run-'))
  const project = join(base, 'app')
  const cp = join(base, 'claude-projects')
  mkdirSync(project)
  mkdirSync(join(cp, slugFor(project)), { recursive: true })
  const log = join(base, 'calls.log')
  process.env.CCM_FAKE_LOG = log
  const transcript = join(cp, slugFor(project), 's1.jsonl')
  const say = (text: string) =>
    writeFileSync(transcript, `${JSON.stringify({ type: 'user', cwd: project, message: { role: 'user', content: text } })}\n`, { flag: 'a' })
  const make = (over: { dailyCap?: number } = {}) => {
    const r = new MemoryRunner({ root: join(base, 'memory'), claudeProjects: cp, command: fake, model: 'haiku', dailyCap: 30, indexCap: 60, today: () => DAY, ...over })
    runners.push(r)
    return r
  }
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [])
  return { base, root: join(base, 'memory'), project, transcript, say, make, calls }
}

describe('MemoryRunner', () => {
  it('first launch imports auto-memory and does not queue old transcripts', async () => {
    const w = world()
    w.say('x'.repeat(9000))
    const r = w.make()
    expect(await r.init()).toBe(true)
    expect(w.calls()).toEqual([])
    expect(readQueue(w.root)).toEqual([])
    expect(readState(w.root).imported).toBe(true)
  })

  it('distills a queued transcript into a committed, indexed memory', async () => {
    const w = world()
    const r = w.make()
    await r.init()
    w.say('x'.repeat(9000))
    enqueue(w.root, { kind: 'distill', transcript: w.transcript })
    await r.drain()
    const slug = slugFor(w.project)
    const fact = readMemory(join(w.root, 'projects', slug, 'topics', 'fake-fact.md'))!
    expect(fact.meta.sources).toEqual(['app.ts']) // not a git repo: left unstamped
    expect(readFileSync(join(w.root, 'projects', slug, 'INDEX.md'), 'utf8')).toContain('fake-fact')
    expect(JSON.parse(readFileSync(join(w.root, 'projects', slug, 'project.json'), 'utf8')).path).toBe(w.project)
    expect((await git(w.root, 'status', '--porcelain')).trim()).toBe('')
    expect(readQueue(w.root)).toEqual([])
    expect(readState(w.root).runs).toEqual({ day: DAY, count: 1 })
  })

  it('skips slices too small to be worth a model call but still advances', async () => {
    const w = world()
    const r = w.make()
    await r.init()
    w.say('short')
    enqueue(w.root, { kind: 'distill', transcript: w.transcript })
    await r.drain()
    expect(w.calls()).toEqual([])
    expect(readQueue(w.root)).toEqual([])
    expect(Object.values(readState(w.root).offsets)[0]).toBeGreaterThan(0)
  })

  it('rolls back output that fails validation, keeping hand edits', async () => {
    const w = world()
    const r = w.make()
    await r.init()
    const mine = join(w.root, 'topics', 'mine.md')
    writeMemory({ file: mine, body: 'hand edit\n', meta: { name: 'mine', type: 'reference', summary: 'mine', sources: [], verified: DAY, used: DAY, uses: 0, stale: false, pinned: false } })
    process.env.CCM_FAKE_SECRET = '1'
    w.say('x'.repeat(9000))
    enqueue(w.root, { kind: 'distill', transcript: w.transcript })
    await r.drain()
    expect(existsSync(join(w.root, 'projects', slugFor(w.project), 'topics', 'fake-fact.md'))).toBe(false)
    expect(readMemory(mine)!.body).toBe('hand edit\n')
    expect(readQueue(w.root)).toEqual([])
    expect(r.log.some(l => l.includes('secret'))).toBe(true)
  })

  it('keeps the job and stops when the distiller fails', async () => {
    const w = world()
    const r = w.make()
    await r.init()
    process.env.CCM_FAKE_FAIL = '1'
    w.say('x'.repeat(9000))
    enqueue(w.root, { kind: 'distill', transcript: w.transcript })
    await r.drain()
    expect(readQueue(w.root)).toHaveLength(1)
    expect(existsSync(join(w.root, 'topics', 'half-written.md'))).toBe(false)
    delete process.env.CCM_FAKE_FAIL
    await r.drain() // halted until next start
    expect(w.calls()).toEqual(['distill'])
  })

  it('leaves jobs queued once the daily cap is reached', async () => {
    const w = world()
    const r = w.make({ dailyCap: 0 })
    await r.init()
    w.say('x'.repeat(9000))
    enqueue(w.root, { kind: 'distill', transcript: w.transcript })
    await r.drain()
    expect(w.calls()).toEqual([])
    expect(readQueue(w.root)).toHaveLength(1)
  })

  it('catches up on transcripts that grew while the app was closed', async () => {
    const w = world()
    const first = w.make()
    await first.init()
    first.stop() // the app closes
    w.say('x'.repeat(9000))
    const again = w.make()
    await again.init()
    expect(w.calls()).toEqual(['distill'])
  })

  it('re-checks a memory whose source changed', async () => {
    const w = world()
    const r = w.make()
    await r.init()
    const gitc = (...a: string[]) => git(w.project, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a)
    await git(w.project, 'init', '-q')
    writeFileSync(join(w.project, 'app.ts'), 'v1')
    await gitc('add', '-A')
    await gitc('commit', '-qm', 'v1')
    const hash = (await git(w.project, 'log', '-1', '--format=%h')).trim()
    const slug = slugFor(w.project)
    writeProject(w.root, slug, w.project)
    const f = join(w.root, 'projects', slug, 'topics', 'a.md')
    writeMemory({ file: f, body: 'fact\n', meta: { name: 'a', type: 'project', summary: 'a', sources: [`app.ts@${hash}`], verified: '2026-09-01', used: DAY, uses: 0, stale: false, pinned: false } })
    writeFileSync(join(w.project, 'app.ts'), 'v2')
    await gitc('commit', '-qam', 'v2')

    await r.drain() // maintenance marks it stale and queues a re-check
    expect(readMemory(f)!.meta.stale).toBe(true)
    await r.drain() // runs the re-check: KEEP
    const m = readMemory(f)!.meta
    expect(m.stale).toBe(false)
    expect(m.verified).toBe(DAY)
    expect(m.sources[0]).not.toBe(`app.ts@${hash}`)
    expect(w.calls()).toEqual(['recheck'])
  })
})
