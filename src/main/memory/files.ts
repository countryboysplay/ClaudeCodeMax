import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const memDir = (): string => process.env.CCM_MEMORY_DIR ?? join(homedir(), '.claudecodemax', 'memory')
export const claudeProjectsDir = (): string => process.env.CCM_CLAUDE_PROJECTS ?? join(homedir(), '.claude', 'projects')
// Same folder naming Claude Code uses under ~/.claude/projects, so memory lines up with transcripts.
export const slugFor = (dir: string): string => dir.replace(/[^a-zA-Z0-9]/g, '-')
export const today = (): string => new Date().toISOString().slice(0, 10)
export const daysBetween = (from: string, to: string): number => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference'
export const TYPES: MemoryType[] = ['user', 'feedback', 'project', 'reference']

export interface Meta {
  name: string
  type: MemoryType
  summary: string
  sources: string[]
  verified: string
  used: string
  uses: number
  stale: boolean
  pinned: boolean
}

export interface Memory {
  file: string
  meta: Meta
  body: string
}

export function parseFrontmatter(text: string): { raw: Record<string, unknown>; body: string } | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!m) return null
  const raw: Record<string, unknown> = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^(\w+):\s*(.*)$/.exec(line)
    if (!kv) continue
    const v = kv[2].trim()
    raw[kv[1]] =
      v.startsWith('[') && v.endsWith(']')
        ? v.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean)
        : v === 'true' ? true : v === 'false' ? false : /^\d+$/.test(v) ? Number(v) : v
  }
  return { raw, body: m[2] }
}

export function toMeta(raw: Record<string, unknown>): Meta | null {
  const str = (k: string) => (typeof raw[k] === 'string' && raw[k] ? (raw[k] as string) : null)
  const name = str('name'), summary = str('summary'), verified = str('verified')
  if (!name || !summary || !verified || !TYPES.includes(raw.type as MemoryType)) return null
  return {
    name,
    type: raw.type as MemoryType,
    summary,
    sources: Array.isArray(raw.sources) ? raw.sources.filter((s): s is string => typeof s === 'string') : [],
    verified,
    used: str('used') ?? verified,
    uses: typeof raw.uses === 'number' ? raw.uses : 0,
    stale: raw.stale === true,
    pinned: raw.pinned === true
  }
}

export function serialize(meta: Meta, body: string): string {
  const lines = Object.entries(meta).map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(', ')}]` : v}`)
  return `---\n${lines.join('\n')}\n---\n${body}`
}

export function readMemory(file: string): Memory | null {
  try {
    const p = parseFrontmatter(readFileSync(file, 'utf8'))
    const meta = p ? toMeta(p.raw) : null
    return p && meta ? { file, meta, body: p.body } : null
  } catch {
    return null
  }
}

export function writeMemory(m: Memory): void {
  mkdirSync(dirname(m.file), { recursive: true })
  writeFileSync(m.file, serialize(m.meta, m.body))
}

export function listMemories(scopeDir: string): Memory[] {
  const files = [join(scopeDir, 'user.md')]
  const topics = join(scopeDir, 'topics')
  if (existsSync(topics)) files.push(...readdirSync(topics).filter(f => f.endsWith('.md')).map(f => join(topics, f)))
  return files.flatMap(f => {
    const m = existsSync(f) ? readMemory(f) : null
    return m ? [m] : []
  })
}

export function projectSlugs(root: string): string[] {
  const dir = join(root, 'projects')
  return existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name) : []
}

export const allMemories = (root: string): Memory[] => [
  ...listMemories(root),
  ...projectSlugs(root).flatMap(s => listMemories(join(root, 'projects', s)))
]

export function projectPath(root: string, slug: string): string | null {
  try {
    const p = JSON.parse(readFileSync(join(root, 'projects', slug, 'project.json'), 'utf8')).path
    return typeof p === 'string' ? p : null
  } catch {
    return null
  }
}

export function writeProject(root: string, slug: string, path: string): void {
  if (projectPath(root, slug) === path) return
  mkdirSync(join(root, 'projects', slug), { recursive: true })
  writeFileSync(join(root, 'projects', slug, 'project.json'), `${JSON.stringify({ path }, null, 2)}\n`)
}
