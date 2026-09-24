import { describe, it, expect } from 'vitest'
import { runShell, killAll } from '../src/main/run'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

describe('runShell', () => {
  it('returns exit code 0 and output', async () => {
    const r = await runShell('echo hello')
    expect(r.code).toBe(0)
    expect(r.output).toContain('hello')
  })
  it('reports a non-zero exit code', async () => expect((await runShell('exit 3')).code).toBe(3))
  it('streams complete lines', async () => {
    const lines: string[] = []
    await runShell('echo one&& echo two', l => lines.push(l.trim()))
    expect(lines).toEqual(['one', 'two'])
  })
  it('killAll stops running commands (no orphans on quit)', async () => {
    const p = runShell('ping -n 30 127.0.0.1')
    await new Promise(r => setTimeout(r, 500))
    killAll()
    expect((await p).code).not.toBe(0)
  }, 15_000)
  it('passes cwd, env and stdin', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ccm-run-'))
    const r = await runShell(
      'node -e "process.stdin.pipe(process.stdout); console.log(require(\'path\').basename(process.cwd()), process.env.CCM_X)"',
      undefined,
      { cwd: dir, env: { ...process.env, CCM_X: 'env-ok' }, input: 'stdin-ok' }
    )
    expect(r.code).toBe(0)
    expect(r.output).toContain(basename(dir))
    expect(r.output).toContain('env-ok')
    expect(r.output).toContain('stdin-ok')
  })
  it('kills the command after timeoutMs', async () => {
    const t = Date.now()
    const r = await runShell('ping -n 30 127.0.0.1', undefined, { timeoutMs: 500 })
    expect(r.code).not.toBe(0)
    expect(Date.now() - t).toBeLessThan(10_000)
  }, 15_000)
})
