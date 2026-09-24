import { writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { daysBetween, listMemories, projectSlugs, type Memory, type Meta } from './files'

// Global and project indexes are injected together, so the total cap is split between them.
export const splitCap = (cap: number) => {
  const global = Math.round(cap * 0.4)
  return { global, project: cap - global }
}
export const isExempt = (m: Meta): boolean => m.pinned || m.type === 'user' || m.type === 'feedback'
export const isDecayed = (m: Meta, day: string): boolean => !isExempt(m) && daysBetween(m.used, day) > 30
const rank = (m: Meta) => (m.pinned ? 0 : isExempt(m) ? 1 : 2)

export function renderIndex(root: string, mems: Memory[], cap: number, day: string): string {
  const lines = mems
    .filter(m => !isDecayed(m.meta, day))
    .sort((a, b) => rank(a.meta) - rank(b.meta) || b.meta.used.localeCompare(a.meta.used) || a.meta.name.localeCompare(b.meta.name))
    .slice(0, cap)
    .map(m => `- [${m.meta.name}](${relative(root, m.file).replace(/\\/g, '/')}) — ${m.meta.summary}${m.meta.stale ? ' (may be stale)' : ''}`)
  return lines.length ? `${lines.join('\n')}\n` : ''
}

export function rebuildIndexes(root: string, cap: number, day: string): void {
  const caps = splitCap(cap)
  writeFileSync(join(root, 'INDEX.md'), renderIndex(root, listMemories(root), caps.global, day))
  for (const slug of projectSlugs(root)) {
    const dir = join(root, 'projects', slug)
    writeFileSync(join(dir, 'INDEX.md'), renderIndex(root, listMemories(dir), caps.project, day))
  }
}
