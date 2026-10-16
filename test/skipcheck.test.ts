import { describe, it, expect } from 'vitest'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { closer, parseSkip, SkipChecker } from '../src/main/skipcheck'
import type { Runner } from '../src/main/run'

const fake = `node "${resolve('test/fixtures/fake-skipcheck.mjs')}"`
const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ccm-skip-'))
  return { dir, file: join(dir, 'cache.json'), log: join(dir, 'log.txt') }
}
const make = (s: ReturnType<typeof setup>, extra: object = {}, env: Record<string, string> = {}) => {
  Object.assign(process.env, { CCM_FAKE_SKIP_LOG: s.log, CCM_FAKE_SKIP_MODE: '', CCM_FAKE_SKIP: '{}', ...env })
  let updates = 0
  const c = new SkipChecker({ file: s.file, command: fake, model: 'haiku', cwd: tmpdir(), onUpdate: () => void updates++, ...extra })
  return { c, updates: () => updates }
}
const calls = (s: ReturnType<typeof setup>) => (existsSync(s.log) ? readFileSync(s.log, 'utf8').split('\n').filter(Boolean) : [])

const table: [string, boolean, boolean, string][] = [
  ['Added the route.\n\nSkipped the e2e test — it needs a live server. Risk: none.', true, true, 'no'],
  ['Added the route.\n\nNot checked: the Windows path. Risk: paths with spaces may break.', true, false, 'yes'],
  ['Fixed it.\n\nSkipped: nothing. Risk: none.', false, false, 'no'],
  ["Done.\n\nI didn't run anything.", false, false, 'no'],
  ['Renamed the button and updated the label.', false, false, 'no'],
  ["Built it.\n\nI didn't run the tests.\n\nWant me to commit?", true, false, 'yes'],
  ["Added the setting.\n\nI haven't tested it.", true, false, 'yes'],
  ['You can turn it on later in Settings.', false, false, 'no'],
  ["The old build didn't start, so I fixed the path.", false, false, 'no'],
  ["Fixed it.\n\nSkipped the docs because they are unchanged. I didn't run the build.", true, false, 'yes']
]

describe('closer', () => {
  it('keeps the last two non-empty lines', () => {
    expect(closer("Built it.\n\nI didn't run the tests.\n\nWant me to commit?")).toBe("I didn't run the tests.\nWant me to commit?")
    expect(closer("I didn't touch the CSS.\n\nStep one.\n\nStep two.\n\nAll done.")).toBe('Step two.\nAll done.')
  })
  it('is empty for an empty reply and capped at 600 chars', () => {
    expect(closer('')).toBe('')
    expect(closer('x'.repeat(2000))).toHaveLength(600)
  })
})

describe('parseSkip', () => {
  it('reads the last JSON line and rejects anything else', () => {
    expect(parseSkip('warn\n{"skipped": true, "reason_given": false}')).toBe(true)
    expect(parseSkip('{"skipped": true, "reason_given": true}')).toBe(false)
    expect(parseSkip('sure!')).toBeNull()
    expect(parseSkip('{"skipped": "yes"}')).toBeNull()
  })
})

describe('SkipChecker', () => {
  it.each(table)('classifies %j', async (reply, skipped, reason, expected) => {
    const s = setup()
    const { c } = make(s, {}, { CCM_FAKE_SKIP: JSON.stringify({ [closer(reply)]: [skipped, reason] }) })
    expect(c.verdict(reply)).toBe('pending')
    await expect.poll(() => c.verdict(reply)).toBe(expected)
  })

  it('gives no for an empty reply without a call', () => {
    const s = setup()
    expect(make(s).c.verdict('')).toBe('no')
    expect(calls(s)).toHaveLength(0)
  })

  it('persists verdicts, and a new checker answers from the cache with no call', async () => {
    const s = setup()
    const reply = "Done.\n\nI didn't run the tests."
    const first = make(s, {}, { CCM_FAKE_SKIP: JSON.stringify({ [closer(reply)]: [true, false] }) })
    first.c.verdict(reply)
    await expect.poll(() => first.c.verdict(reply)).toBe('yes')
    const second = make(s)
    expect(second.c.verdict(reply)).toBe('yes')
    expect(calls(s)).toHaveLength(1)
    expect(second.updates()).toBe(0)
  })

  it('runs claude with no session, project settings only, no tools', async () => {
    const s = setup()
    const { c } = make(s)
    c.verdict('Hello there.')
    await expect.poll(() => calls(s).length).toBe(1)
    const args = calls(s)[0]
    for (const a of ['--no-session-persistence', '--setting-sources project', '--tools', '--model haiku']) expect(args).toContain(a)
  })

  it('bad JSON ends unchecked, is not retried this run, and is not cached', async () => {
    const s = setup()
    const { c } = make(s, {}, { CCM_FAKE_SKIP_MODE: 'bad' })
    c.verdict('One.')
    await expect.poll(() => c.verdict('One.')).toBe('unchecked')
    expect(calls(s)).toHaveLength(1)
    expect(existsSync(s.file)).toBe(false)
  })

  it('a failure stops classification; Refresh (rearm) retries with a working classifier', async () => {
    const s = setup()
    const { c, updates } = make(s, {}, { CCM_FAKE_SKIP_MODE: 'fail' })
    for (const r of ['A.', 'B.', 'C.']) c.verdict(r)
    for (const r of ['A.', 'B.', 'C.']) await expect.poll(() => c.verdict(r)).toBe('unchecked')
    expect(c.verdict('D.')).toBe('unchecked')
    expect(calls(s).length).toBeLessThanOrEqual(2)
    const before = calls(s).length
    expect(c.verdict('D.')).toBe('unchecked')
    expect(calls(s)).toHaveLength(before)
    expect(updates()).toBeGreaterThan(0)

    process.env.CCM_FAKE_SKIP_MODE = ''
    c.rearm()
    for (const r of ['A.', 'B.', 'C.', 'D.']) {
      c.verdict(r)
      await expect.poll(() => c.verdict(r)).toBe('no')
    }
  })

  it('rearm when nothing tripped changes nothing', async () => {
    const s = setup()
    const { c } = make(s)
    c.verdict('A.')
    c.rearm()
    await expect.poll(() => c.verdict('A.')).toBe('no')
    expect(calls(s)).toHaveLength(1)
  })

  it('a timeout ends unchecked and stops further calls', async () => {
    const s = setup()
    const { c } = make(s, { timeoutMs: 1500 }, { CCM_FAKE_SKIP_MODE: 'hang' })
    c.verdict('A.')
    await expect.poll(() => c.verdict('A.'), { timeout: 15_000 }).toBe('unchecked')
    expect(c.verdict('B.')).toBe('unchecked')
  })

  it('runs at most 2 at a time and notifies after the drain', async () => {
    const s = setup()
    let active = 0
    let peak = 0
    const run: Runner = async () => {
      peak = Math.max(peak, ++active)
      await new Promise(r => setTimeout(r, 50))
      active--
      return { code: 0, output: '{"skipped": false, "reason_given": false}' }
    }
    const { c, updates } = make(s, { run })
    const replies = ['1.', '2.', '3.', '4.', '5.', '6.']
    for (const r of replies) c.verdict(r)
    for (const r of replies) await expect.poll(() => c.verdict(r)).toBe('no')
    expect(peak).toBe(2)
    expect(updates()).toBeGreaterThan(0)
  })
})
