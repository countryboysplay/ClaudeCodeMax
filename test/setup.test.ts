import { describe, it, expect } from 'vitest'
import { STEPS, check, install, blockedBy, needsWizard } from '../src/main/setup'
import type { Runner } from '../src/main/run'

type Table = Record<string, { code: number; output: string }>

function fakeRunner(table: Table) {
  const calls: string[] = []
  const run: Runner = async (cmd, onLine) => {
    calls.push(cmd)
    const r = table[cmd] ?? { code: 1, output: `'${cmd}' is not recognized as an internal or external command` }
    r.output.split('\n').forEach(l => l && onLine?.(l))
    return r
  }
  return { run, calls }
}

const step = (id: string) => STEPS.find(s => s.id === id)!
const allOk = Object.fromEntries(STEPS.map(s => [s.id, true]))

describe('check', () => {
  it('rejects Node older than 22.13 (numeric compare)', async () =>
    expect(await check(step('node'), fakeRunner({ 'node -v': { code: 0, output: 'v22.9.0' } }).run)).toBe(false))
  it('accepts Node 22.13+', async () =>
    expect(await check(step('node'), fakeRunner({ 'node -v': { code: 0, output: 'v22.13.1' } }).run)).toBe(true))
  it('fails when the command is missing', async () => expect(await check(step('git'), fakeRunner({}).run)).toBe(false))
  it('requires ponytail in the plugin list', async () => {
    const without = fakeRunner({ 'claude plugin list': { code: 0, output: 'superpowers@official' } }).run
    const withIt = fakeRunner({ 'claude plugin list': { code: 0, output: 'ponytail@ponytail  enabled' } }).run
    expect(await check(step('ponytail'), without)).toBe(false)
    expect(await check(step('ponytail'), withIt)).toBe(true)
  })
})

describe('install', () => {
  it('runs commands in order and streams them', async () => {
    const { run, calls } = fakeRunner({
      'uv tool install graphifyy': { code: 0, output: 'Installed graphifyy' },
      'graphify install': { code: 0, output: 'skill registered' }
    })
    const lines: string[] = []
    const r = await install(step('graphify'), run, l => lines.push(l))
    expect(r.ok).toBe(true)
    expect(calls).toEqual(['uv tool install graphifyy', 'graphify install'])
    expect(lines[0]).toBe('> uv tool install graphifyy')
  })
  it('stops at the first failing command and returns its output', async () => {
    const { run, calls } = fakeRunner({ 'uv tool install graphifyy': { code: 2, output: 'network down' } })
    const r = await install(step('graphify'), run, () => {})
    expect(r).toEqual({ ok: false, error: 'network down' })
    expect(calls).toEqual(['uv tool install graphifyy'])
  })
  it('reports the exit code when a failure prints nothing', async () => {
    const { run } = fakeRunner({ 'npm install -g codeburn': { code: 5, output: '' } })
    expect((await install(step('codeburn'), run, () => {})).error).toBe('Exited with code 5')
  })
})

describe('blockedBy', () => {
  it('names the missing dependency', () => expect(blockedBy(step('headroom'), { ...allOk, uv: false })).toBe('uv (Python tools)'))
  it('is null when the dependency is installed', () => expect(blockedBy(step('headroom'), allOk)).toBeNull())
  it('is null for steps without dependencies', () => expect(blockedBy(step('git'), {})).toBeNull())
})

describe('needsWizard', () => {
  it('is false when everything is installed', () => expect(needsWizard(allOk, [])).toBe(false))
  it('is true when a required tool is missing, even if skipped', () =>
    expect(needsWizard({ ...allOk, claude: false }, ['claude'])).toBe(true))
  it('is true when an optional tool is missing and not skipped', () => expect(needsWizard({ ...allOk, headroom: false }, [])).toBe(true))
  it('is false when a missing optional tool was skipped', () => expect(needsWizard({ ...allOk, headroom: false }, ['headroom'])).toBe(false))
})

describe('STEPS', () => {
  it('lists every tool in install order', () =>
    expect(STEPS.map(s => s.id)).toEqual(['git', 'node', 'uv', 'claude', 'codeburn', 'headroom', 'graphify', 'ponytail']))
  it('marks git, node, claude and codeburn as required', () =>
    expect(STEPS.filter(s => s.required).map(s => s.id)).toEqual(['git', 'node', 'claude', 'codeburn']))
})
