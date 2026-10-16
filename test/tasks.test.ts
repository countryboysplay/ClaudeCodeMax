import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseTranscript, readTasks } from '../src/main/tasks'
import { slugFor } from '../src/main/memory/files'

const line = (o: object) => JSON.stringify(o)
const user = (content: unknown, ts = '2026-10-16T10:00:00Z', extra = {}) => line({ type: 'user', timestamp: ts, message: { role: 'user', content }, ...extra })
const said = (...content: object[]) => line({ type: 'assistant', message: { role: 'assistant', content } })

const transcript = [
  user('Add a login page', '2026-10-16T10:00:00Z'),
  said({ type: 'tool_use', name: 'Write', input: { file_path: 'C:/proj/src/login.tsx' } }),
  user([{ type: 'tool_result', content: 'ok' }]),
  line({ type: 'queue-operation', operation: 'enqueue', content: 'make it blue' }),
  line({ type: 'queue-operation', operation: 'enqueue', content: 'make it blue' }),
  said({ type: 'tool_use', name: 'Edit', input: { file_path: 'C:/proj/src/login.tsx' } }),
  said({ type: 'text', text: 'Built the page.\n\nSkipped the tests.' }),
  user('<local-command-stdout>model set</local-command-stdout>'),
  user('<command-name>/ponytail-review</command-name>', '2026-10-16T11:00:00Z'),
  said({ type: 'text', text: 'Looks fine.\n\nSkipped the CSS because it is unchanged.' }),
  user('Now add signup', '2026-10-16T12:00:00Z'),
  said({ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }),
  user([{ type: 'tool_result', content: '' }, { type: 'text', text: '[Request interrupted by user for tool use]' }]),
  user('side question', '2026-10-16T12:30:00Z', { isSidechain: true }),
  user('<command-name>/context</command-name>', '2026-10-16T12:45:00Z'),
  user('Last one', '2026-10-16T13:00:00Z'),
  'not json'
].join('\n')

describe('parseTranscript', () => {
  const tasks = parseTranscript(transcript, f => f.replace('C:/proj/', ''))

  it('starts a task only at typed requests and slash commands', () =>
    expect(tasks.map(t => t.asked)).toEqual(['Add a login page', '/ponytail-review', 'Now add signup', 'Last one']))

  it('collects edited files once, mid-turn messages once, and the closing note', () => {
    expect(tasks[0].files).toEqual(['src/login.tsx'])
    expect(tasks[0].added).toEqual(['make it blue'])
    expect(tasks[0].note).toBe('Skipped the tests.')
    expect(tasks[0].reply).toBe('Built the page.\n\nSkipped the tests.')
    expect(tasks[0].when).toBe('2026-10-16T10:00:00Z')
  })

  it('flags a skip with no reason, but not one with a reason', () => {
    expect(tasks[0].skipFlag).toBe(true)
    expect(tasks[1].skipFlag).toBe(false)
  })

  it('drops local slash commands that got no reply and changed nothing', () =>
    expect(tasks.some(t => t.asked === '/context')).toBe(false))

  it('marks interrupted tasks and tasks with no reply as unfinished', () =>
    expect(tasks.map(t => t.unfinished)).toEqual([false, false, true, true]))
})

describe('readTasks', () => {
  it('reads every session for the project, newest first, with task-file checklists', async () => {
    const base = mkdtempSync(join(tmpdir(), 'ccm-tasks-'))
    const project = join(base, 'proj')
    const cp = join(base, 'projects')
    const ct = join(base, 'tasks')
    mkdirSync(join(cp, slugFor(project)), { recursive: true })
    writeFileSync(join(cp, slugFor(project), 's1.jsonl'), user('old', '2026-10-01T00:00:00Z'))
    writeFileSync(
      join(cp, slugFor(project), 's2.jsonl'),
      [user('new', '2026-10-02T00:00:00Z'), said({ type: 'tool_use', name: 'Write', input: { file_path: join(project, 'a.ts') } })].join('\n')
    )
    mkdirSync(join(ct, 's2'), { recursive: true })
    writeFileSync(join(ct, 's2', '1.json'), line({ subject: 'Write a.ts', status: 'completed' }))
    const tasks = await readTasks(project, cp, ct)
    expect(tasks.map(t => t.asked)).toEqual(['new', 'old'])
    expect(tasks[0].files).toEqual(['a.ts'])
    expect(tasks[0].checklist).toEqual([{ subject: 'Write a.ts', status: 'completed' }])
  })

  it('returns nothing for a project with no sessions', async () =>
    expect(await readTasks(join(tmpdir(), 'nope-ccm'), join(tmpdir(), 'nope-cp'), join(tmpdir(), 'nope-ct'))).toEqual([]))
})
