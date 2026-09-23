import { describe, it, expect } from 'vitest'
import { runShell, killAll } from '../src/main/run'

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
})
