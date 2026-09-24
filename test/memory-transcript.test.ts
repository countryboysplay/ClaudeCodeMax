import { describe, it, expect } from 'vitest'
import { appendFileSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sliceTranscript } from '../src/main/memory/transcript'

const dir = mkdtempSync(join(tmpdir(), 'ccm-tr-'))
const line = (o: object) => `${JSON.stringify(o)}\n`
const user = (content: unknown, extra = {}) => line({ type: 'user', cwd: 'C:\\code\\p', message: { role: 'user', content }, ...extra })
const assistant = (content: unknown[]) => line({ type: 'assistant', message: { role: 'assistant', content } })

describe('sliceTranscript', () => {
  it('keeps user and assistant text, names tools, drops tool output and meta', () => {
    const f = join(dir, 'a.jsonl')
    writeFileSync(f,
      user('please fix the release') +
      user([{ type: 'text', text: 'skill text' }], { isMeta: true }) +
      assistant([{ type: 'text', text: 'on it' }, { type: 'tool_use', name: 'Read', input: { file_path: 'C:\\mem\\topics\\a.md' } }, { type: 'tool_use', name: 'Bash', input: { command: 'ls' } }]) +
      user([{ type: 'tool_result', content: 'HUGE OUTPUT' }]) +
      line({ type: 'system', content: 'x' }))
    const s = sliceTranscript(f, 0)
    expect(s.text).toBe('USER: please fix the release\nCLAUDE: on it\nTOOL: Read C:\\mem\\topics\\a.md\nTOOL: Bash')
    expect(s.reads).toEqual(['C:\\mem\\topics\\a.md'])
    expect(s.cwd).toBe('C:\\code\\p')
    expect(s.end).toBe(statSync(f).size)
  })
  it('resumes from an offset', () => {
    const f = join(dir, 'b.jsonl')
    writeFileSync(f, user('first'))
    const a = sliceTranscript(f, 0)
    appendFileSync(f, user('second'))
    expect(sliceTranscript(f, a.end).text).toBe('USER: second')
  })
  it('stops before a partial last line', () => {
    const f = join(dir, 'c.jsonl')
    const whole = user('done')
    writeFileSync(f, `${whole}{"type":"user","mess`)
    const s = sliceTranscript(f, 0)
    expect(s.text).toBe('USER: done')
    expect(s.end).toBe(Buffer.byteLength(whole))
  })
  it('restarts at 0 when the file shrank below the offset', () => {
    const f = join(dir, 'd.jsonl')
    writeFileSync(f, user('fresh'))
    expect(sliceTranscript(f, 1_000_000).text).toBe('USER: fresh')
  })
  it('keeps the newest maxChars', () => {
    const f = join(dir, 'e.jsonl')
    writeFileSync(f, user('a'.repeat(50)) + user('b'.repeat(50)))
    const s = sliceTranscript(f, 0, 20)
    expect(s.text).toBe('b'.repeat(20))
  })
})
