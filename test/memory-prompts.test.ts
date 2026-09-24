import { describe, it, expect } from 'vitest'
import { distillPrompt, parseVerdict, recheckPrompt } from '../src/main/memory/prompts'

describe('prompts', () => {
  it('distill prompt names the project folder, the day and the excerpt', () => {
    const p = distillPrompt({ slice: 'USER: hi', globalIndex: '', projectIndex: '- [a](x) — y', projectDir: 'projects/C--app', day: '2026-09-24' })
    expect(p).toContain('projects/C--app/topics/<name>.md')
    expect(p).toContain('verified: 2026-09-24')
    expect(p).toContain('(empty)')
    expect(p).toContain('- [a](x) — y')
    expect(p.trimEnd().endsWith('USER: hi')).toBe(true)
  })
  it('recheck prompt starts with RECHECK and marks deleted files', () => {
    const m = { file: 'x', body: 'fact', meta: { name: 'a', type: 'project' as const, summary: 's', sources: [], verified: 'd', used: 'd', uses: 0, stale: true, pinned: false } }
    const p = recheckPrompt(m, [{ file: 'a.ts', text: 'code' }, { file: 'b.ts', text: null }])
    expect(p.startsWith('RECHECK')).toBe(true)
    expect(p).toContain('<<<a.ts>>>\ncode')
    expect(p).toContain('<<<b.ts>>>\n(deleted)')
  })
  it('parses verdicts', () => {
    expect(parseVerdict('KEEP')).toEqual({ verdict: 'KEEP', body: '' })
    expect(parseVerdict('noise\nREWRITE\nNew text.\n')).toEqual({ verdict: 'REWRITE', body: 'New text.\n' })
    expect(parseVerdict('DELETE — obsolete')?.verdict).toBe('DELETE')
    expect(parseVerdict('I am not sure')).toBeNull()
  })
})
