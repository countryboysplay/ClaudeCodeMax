import { describe, it, expect, afterAll } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { runShell } from '../src/main/run'
import { slugFor } from '../src/main/memory/files'
import { resumeFlag } from '../src/main/usage'
import { parseTranscript } from '../src/main/tasks'
import { sliceTranscript } from '../src/main/memory/transcript'

// Opt-in: spends a little real plan usage. Run with: $env:CCM_REAL_CLAUDE=1; npm run e2e:real
describe.skipIf(!process.env.CCM_REAL_CLAUDE)('real Claude Code', () => {
  const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), 'ccm-real-')))
  const id = randomUUID()
  const dir = join(homedir(), '.claude', 'projects', slugFor(cwd))
  const claude = (flags: string, prompt: string) =>
    runShell(`claude -p --setting-sources project ${flags} "${prompt}"`, undefined, { cwd, env: { ...process.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' } })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  })

  it('starts on haiku, resumes the same transcript on sonnet, and our parsers read it', { timeout: 360_000 }, async () => {
    const a = await claude(`--model haiku --session-id ${id}`, 'Reply with only the word apple')
    expect(a.code, a.output).toBe(0)
    const b = await claude(`--model sonnet --resume ${id}`, 'Reply with only the word pear')
    expect(b.code, b.output).toBe(0)

    const file = join(dir, `${id}.jsonl`)
    expect(existsSync(file)).toBe(true)
    expect(readdirSync(dir).filter(f => f.endsWith('.jsonl'))).toHaveLength(1)
    expect(resumeFlag(id, dir)).toBe(` --resume ${id}`)

    const text = readFileSync(file, 'utf8')
    const tasks = parseTranscript(text)
    expect(tasks.map(t => t.asked)).toEqual(['Reply with only the word apple', 'Reply with only the word pear'])
    for (const t of tasks) {
      expect(t.reply).not.toBe('')
      expect(t.unfinished).toBe(false)
    }
    const models = text
      .split('\n')
      .flatMap(l => {
        try {
          const o = JSON.parse(l)
          return o.type === 'assistant' && o.message?.model && o.message.model !== '<synthetic>' ? [String(o.message.model)] : []
        } catch {
          return []
        }
      })
    expect(models[0]).toContain('haiku')
    expect(models.at(-1)).toContain('sonnet')

    const s = sliceTranscript(file, 0)
    expect(s.cwd).toBe(cwd)
    expect(s.text).toContain('USER: Reply with only the word apple')
  })
})
