import { execFile } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, windowsHide: true, maxBuffer: 16 << 20 })
  return stdout
}

export async function ensureRepo(root: string): Promise<void> {
  mkdirSync(join(root, 'topics'), { recursive: true })
  mkdirSync(join(root, 'projects'), { recursive: true })
  if (existsSync(join(root, '.git'))) return
  writeFileSync(join(root, '.gitignore'), '.state.json\n.queue\n.injected\n')
  await git(root, 'init', '-q')
  await commit(root, 'Start memory')
}

export async function commit(root: string, message: string): Promise<boolean> {
  await git(root, 'add', '-A')
  if (!(await git(root, 'status', '--porcelain')).trim()) return false
  await git(root, '-c', 'user.name=ClaudeCodeMax', '-c', 'user.email=memory@claudecodemax.local', 'commit', '-q', '-m', message)
  return true
}

export const pathKey = (p: string): string => resolve(p).toLowerCase()

export interface MemState {
  offsets: Record<string, number>
  runs: { day: string; count: number }
  imported: boolean
  // Set right before the distiller's run() and cleared once validate/commit/rollback finishes.
  // If this is still set at the next init(), the previous run died mid-distill.
  inFlight: string | null
}

export function readState(root: string): MemState {
  const d: MemState = { offsets: {}, runs: { day: '', count: 0 }, imported: false, inFlight: null }
  try {
    const v = JSON.parse(readFileSync(join(root, '.state.json'), 'utf8'))
    return {
      offsets: v.offsets && typeof v.offsets === 'object' ? v.offsets : d.offsets,
      runs: typeof v.runs?.day === 'string' && typeof v.runs?.count === 'number' ? v.runs : d.runs,
      imported: v.imported === true,
      inFlight: typeof v.inFlight === 'string' ? v.inFlight : null
    }
  } catch {
    return d
  }
}

export const writeState = (root: string, s: MemState): void => writeFileSync(join(root, '.state.json'), JSON.stringify(s))

export type Job = { kind: 'distill'; transcript: string } | { kind: 'recheck'; file: string }

const jobKey = (j: Job) => (j.kind === 'distill' ? `d:${pathKey(j.transcript)}` : `r:${pathKey(j.file)}`)
const queueFile = (root: string) => join(root, '.queue')

export function readQueue(root: string): Job[] {
  let text = ''
  try {
    text = readFileSync(queueFile(root), 'utf8')
  } catch {
    return []
  }
  const seen = new Set<string>()
  const jobs: Job[] = []
  for (const line of text.split('\n')) {
    let j: Job
    try {
      j = JSON.parse(line)
    } catch {
      continue
    }
    const ok = (j?.kind === 'distill' && typeof j.transcript === 'string') || (j?.kind === 'recheck' && typeof j.file === 'string')
    if (!ok || seen.has(jobKey(j))) continue
    seen.add(jobKey(j))
    jobs.push(j)
  }
  return jobs
}

export const enqueue = (root: string, job: Job): void => appendFileSync(queueFile(root), `${JSON.stringify(job)}\n`)

// ponytail: read-then-rewrite can drop a hook append that lands in between; the next catch-up re-queues it.
export function removeJob(root: string, job: Job): void {
  const rest = readQueue(root).filter(j => jobKey(j) !== jobKey(job))
  writeFileSync(queueFile(root), rest.map(j => `${JSON.stringify(j)}\n`).join(''))
}
