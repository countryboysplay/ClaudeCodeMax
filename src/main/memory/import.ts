import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { TYPES, writeMemory, type MemoryType } from './files'

// Copies Claude Code's auto-memory into the project tier. Sources are read, never changed.
export function importAutoMemory(root: string, claudeProjects: string, skipSlug: string): number {
  if (!existsSync(claudeProjects)) return 0
  let n = 0
  for (const slug of readdirSync(claudeProjects)) {
    const src = join(claudeProjects, slug, 'memory')
    if (slug === skipSlug || !existsSync(src)) continue
    for (const f of readdirSync(src)) {
      const dest = join(root, 'projects', slug, 'topics', f)
      if (!f.endsWith('.md') || f === 'MEMORY.md' || existsSync(dest)) continue
      const text = readFileSync(join(src, f), 'utf8')
      const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
      const field = (k: string) => (fm ? new RegExp(`^\\s*${k}:\\s*(.+)$`, 'm').exec(fm[1])?.[1].trim() : undefined)
      const body = fm ? text.slice(fm[0].length) : text
      const type = field('type') as MemoryType | undefined
      const day = statSync(join(src, f)).mtime.toISOString().slice(0, 10)
      const name = field('name') ?? f.slice(0, -3)
      writeMemory({
        file: dest,
        body,
        meta: {
          name,
          type: type && TYPES.includes(type) ? type : 'project',
          summary: field('description') ?? body.split('\n').find(l => l.trim())?.trim().slice(0, 100) ?? name,
          sources: [],
          verified: day,
          used: day,
          uses: 0,
          stale: false,
          pinned: false
        }
      })
      n++
    }
  }
  return n
}
