import { describe, it, expect } from 'vitest'
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commit, enqueue, ensureRepo, git, readQueue, readState, removeJob, writeState } from '../src/main/memory/store'

const fresh = () => mkdtempSync(join(tmpdir(), 'ccm-store-'))

describe('repo', () => {
  it('initialises once, ignoring machine-local files', async () => {
    const root = fresh()
    await ensureRepo(root)
    await ensureRepo(root)
    expect(existsSync(join(root, '.git'))).toBe(true)
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe('.state.json\n.queue\n.injected\n')
    expect((await git(root, 'log', '--oneline')).trim().split('\n')).toHaveLength(1)
  })
  it('commits only when something changed', async () => {
    const root = fresh()
    await ensureRepo(root)
    expect(await commit(root, 'nothing')).toBe(false)
    writeFileSync(join(root, 'topics', 'a.md'), 'x')
    writeFileSync(join(root, '.state.json'), '{}')
    expect(await commit(root, 'add a')).toBe(true)
    expect((await git(root, 'status', '--porcelain')).trim()).toBe('')
  })
})

describe('state', () => {
  it('falls back to defaults when missing or corrupt', () => {
    const root = fresh()
    expect(readState(root)).toEqual({ offsets: {}, runs: { day: '', count: 0 }, imported: false, inFlight: null })
    writeFileSync(join(root, '.state.json'), '{bad')
    expect(readState(root).imported).toBe(false)
  })
  it('round-trips', () => {
    const root = fresh()
    writeState(root, { offsets: { a: 5 }, runs: { day: '2026-09-24', count: 2 }, imported: true, inFlight: 'x' })
    expect(readState(root)).toEqual({ offsets: { a: 5 }, runs: { day: '2026-09-24', count: 2 }, imported: true, inFlight: 'x' })
  })
})

describe('queue', () => {
  it('dedupes by normalized path and skips bad lines', () => {
    const root = fresh()
    enqueue(root, { kind: 'distill', transcript: 'C:\\t\\A.jsonl' })
    appendFileSync(join(root, '.queue'), 'not json\n{"kind":"other"}\n')
    enqueue(root, { kind: 'distill', transcript: 'c:/t/a.jsonl' })
    enqueue(root, { kind: 'recheck', file: 'C:\\m\\x.md' })
    expect(readQueue(root)).toEqual([
      { kind: 'distill', transcript: 'C:\\t\\A.jsonl' },
      { kind: 'recheck', file: 'C:\\m\\x.md' }
    ])
  })
  it('removes one job and keeps the rest', () => {
    const root = fresh()
    enqueue(root, { kind: 'distill', transcript: 'C:\\t\\a.jsonl' })
    enqueue(root, { kind: 'distill', transcript: 'C:\\t\\b.jsonl' })
    removeJob(root, { kind: 'distill', transcript: 'C:\\t\\a.jsonl' })
    expect(readQueue(root)).toEqual([{ kind: 'distill', transcript: 'C:\\t\\b.jsonl' }])
  })
  it('is empty when the file is missing', () => expect(readQueue(fresh())).toEqual([]))
})
