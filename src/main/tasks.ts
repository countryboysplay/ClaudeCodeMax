import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, isAbsolute, join, relative } from 'node:path'
import { slugFor } from './memory/files'
import type { Task } from '../shared/types'

const MAX_TASKS = 200
const EDIT_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit'])
const SKIP = /\b(skip|skipped|skipping|didn't|did not|not checked|deferred|later|left out|out of scope)\b/i
const INTERRUPT = '[Request interrupted'

// Unlike code comments, a comma in prose is not a reason ("I didn't build it, test it or run it").
const proseReason = (s: string) => / — | - /.test(s) || /\b(because|since|until|so that|to avoid|when)\b/i.test(s)

const lastParagraph = (s: string) => (s.trim().split(/\n\s*\n/).pop() ?? '').trim().slice(0, 600)

// The request the user typed, or null for user-role lines that aren't one (tool results, command output).
function typed(content: unknown): string | null {
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content) && !content.some(b => b?.type === 'tool_result')
        ? content.filter(b => b?.type === 'text').map(b => String(b.text)).join('\n')
        : ''
  if (!text.trim()) return null
  const cmd = /<command-name>([^<]*)<\/command-name>/.exec(text)
  if (cmd) return cmd[1].trim()
  return text.trimStart().startsWith('<') ? null : text.trim()
}

export function parseTranscript(text: string, rel: (file: string) => string = f => f): Task[] {
  const tasks: Task[] = []
  let t: Task | null = null
  for (const raw of text.split('\n')) {
    let o: any
    try {
      o = JSON.parse(raw)
    } catch {
      continue
    }
    if (o.isMeta || o.isSidechain || o.isCompactSummary || o.isVisibleInTranscriptOnly) continue
    if (o.type === 'queue-operation') {
      if (t && o.operation === 'enqueue' && typeof o.content === 'string' && !t.added.includes(o.content)) t.added.push(o.content)
    } else if (o.type === 'user') {
      if (JSON.stringify(o.message?.content ?? '').includes(INTERRUPT)) {
        if (t) t.unfinished = true
        continue
      }
      const asked = typed(o.message?.content)
      if (asked === null) continue
      // A message queued mid-turn that ran as its own request isn't something added to the previous one.
      if (t) t.added = t.added.filter(a => a !== asked)
      t = { when: String(o.timestamp ?? ''), asked, added: [], files: [], note: '', reply: '', unfinished: false, skipFlag: false, checklist: [] }
      tasks.push(t)
    } else if (o.type === 'assistant' && t && Array.isArray(o.message?.content)) {
      for (const b of o.message.content) {
        if (b?.type === 'text' && String(b.text).trim()) t.reply = String(b.text)
        const f = b?.input?.file_path ?? b?.input?.notebook_path
        if (b?.type === 'tool_use' && EDIT_TOOLS.has(b.name) && typeof f === 'string' && !t.files.includes(rel(f))) t.files.push(rel(f))
      }
    }
  }
  for (const x of tasks) {
    x.note = lastParagraph(x.reply)
    if (!x.reply) x.unfinished = true
    x.skipFlag = SKIP.test(x.note) && !proseReason(x.note)
  }
  // Local commands like /context or /model get no reply and change nothing: not tasks.
  return tasks.filter(x => !(x.asked.startsWith('/') && !x.reply && !x.files.length))
}

function readChecklist(dir: string): Task['checklist'] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .sort((a, b) => parseInt(a) - parseInt(b))
    .flatMap(f => {
      try {
        const j = JSON.parse(readFileSync(join(dir, f), 'utf8'))
        return typeof j.subject === 'string' ? [{ subject: j.subject, status: String(j.status ?? '') }] : []
      } catch {
        return []
      }
    })
}

// Reads one transcript at a time so a large project (100+ MB) doesn't freeze the window.
export async function readTasks(projectDir: string, claudeProjects: string, claudeTasks: string): Promise<Task[]> {
  const dir = join(claudeProjects, slugFor(projectDir))
  if (!existsSync(dir)) return []
  const rel = (f: string) => {
    const r = relative(projectDir, f)
    return r && !r.startsWith('..') && !isAbsolute(r) ? r.replace(/\\/g, '/') : f
  }
  const all: Task[] = []
  for (const f of readdirSync(dir).filter(n => n.endsWith('.jsonl'))) {
    let text: string
    try {
      text = await readFile(join(dir, f), 'utf8')
    } catch {
      continue
    }
    const tasks = parseTranscript(text, rel)
    // Task files are per session, so the checklist goes on the session's last task.
    const last = tasks.at(-1)
    if (last) last.checklist = readChecklist(join(claudeTasks, basename(f, '.jsonl')))
    all.push(...tasks)
  }
  return all.sort((a, b) => b.when.localeCompare(a.when)).slice(0, MAX_TASKS)
}
