import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const hook = resolve('resources/memory-hook.mjs')
const run = (event: string, input: string, env: Record<string, string>) =>
  spawnSync('node', [hook, event], { input, encoding: 'utf8', env: { ...process.env, ...env } })

function memory() {
  const root = mkdtempSync(join(tmpdir(), 'ccm-hook-'))
  writeFileSync(join(root, 'INDEX.md'), '- [g](topics/g.md) — global fact\n')
  mkdirSync(join(root, 'projects', 'C--code-app'), { recursive: true })
  writeFileSync(join(root, 'projects', 'C--code-app', 'INDEX.md'), '- [p](projects/C--code-app/topics/p.md) — project fact\n')
  return root
}

describe('memory-hook start', () => {
  it('prints both indexes for the project and records the injected size', () => {
    const root = memory()
    const r = run('start', JSON.stringify({ cwd: 'C:\\code\\app' }), { CCM_MEMORY_DIR: root })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain(`Memory lives in ${root}`)
    expect(r.stdout).toContain('global fact')
    expect(r.stdout).toContain('project fact')
    expect(Number(readFileSync(join(root, '.injected'), 'utf8'))).toBe(Buffer.byteLength(r.stdout.trimEnd()))
  })
  it('prints nothing when there is no memory', () => {
    const r = run('start', JSON.stringify({ cwd: 'C:\\x' }), { CCM_MEMORY_DIR: join(tmpdir(), 'ccm-none-xyz') })
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')
  })
  it('exits 0 silently on garbage input', () => {
    const r = run('start', '{not json', { CCM_MEMORY_DIR: memory() })
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')
  })
  it('does nothing inside the distiller', () => {
    const root = memory()
    const r = run('start', JSON.stringify({ cwd: 'C:\\code\\app' }), { CCM_MEMORY_DIR: root, CCM_DISTILLER: '1' })
    expect(r.stdout).toBe('')
    run('enqueue', JSON.stringify({ transcript_path: 'C:\\t.jsonl' }), { CCM_MEMORY_DIR: root, CCM_DISTILLER: '1' })
    expect(existsSync(join(root, '.queue'))).toBe(false)
  })
})

describe('memory-hook enqueue', () => {
  it('appends a distill job', () => {
    const root = memory()
    run('enqueue', JSON.stringify({ transcript_path: 'C:\\t\\a.jsonl' }), { CCM_MEMORY_DIR: root })
    run('enqueue', JSON.stringify({ transcript_path: 'C:\\t\\b.jsonl' }), { CCM_MEMORY_DIR: root })
    expect(readFileSync(join(root, '.queue'), 'utf8')).toBe(
      '{"kind":"distill","transcript":"C:\\\\t\\\\a.jsonl"}\n{"kind":"distill","transcript":"C:\\\\t\\\\b.jsonl"}\n'
    )
  })
})
