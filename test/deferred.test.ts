import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hasReason, scanDeferred } from '../src/main/deferred'

describe('hasReason', () => {
  it.each(['no retry, add one when the API flakes', 'kept simple because only one user', 'until we have real data', 'cache — fine below 1k rows'])(
    'accepts %s',
    t => expect(hasReason(t)).toBe(true)
  )
  it.each(['handle errors', 'no retry', ''])('rejects %s', t => expect(hasReason(t)).toBe(false))
})

describe('scanDeferred', () => {
  it('returns nothing instead of throwing when the folder cannot be read', async () =>
    expect(await scanDeferred(join(tmpdir(), 'ccm-missing-folder'))).toEqual({ deferred: [], scanCapped: false }))

  it('finds comment markers, puts the ones with no reason first, and skips noise', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ccm-def-'))
    writeFileSync(join(dir, 'a.ts'), 'const x = 1\n// shortcut: one retry only, add backoff when it flakes\n// TODO handle errors\n')
    writeFileSync(join(dir, 'b.py'), '# FIXME: slow\nprint("TODO in a string is not a comment")\n')
    writeFileSync(join(dir, 'c.css'), '/* ponytail: no dark theme until asked */\n')
    mkdirSync(join(dir, 'node_modules'))
    writeFileSync(join(dir, 'node_modules', 'd.js'), '// TODO ignored\n')
    writeFileSync(join(dir, 'e.bin'), Buffer.from([0, 1, 2, 47, 47, 32, 84, 79, 68, 79]))
    writeFileSync(join(dir, 'f.ts'), "const fixture = '// TODO inside a string'\n")
    writeFileSync(join(dir, 'notes.md'), '```ts\n// shortcut: quoted in a doc\n```\n')
    const { deferred, scanCapped } = await scanDeferred(dir)
    expect(scanCapped).toBe(false)
    expect(deferred.map(d => [d.file, d.line, d.marker, d.text, d.reason])).toEqual([
      ['a.ts', 3, 'TODO', 'handle errors', false],
      ['b.py', 1, 'FIXME', 'slow', false],
      ['a.ts', 2, 'shortcut', 'one retry only, add backoff when it flakes', true],
      ['c.css', 1, 'ponytail', 'no dark theme until asked', true]
    ])
  })
})
