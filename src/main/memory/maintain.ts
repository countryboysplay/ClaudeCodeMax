import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'
import { allMemories, daysBetween, listMemories, projectPath, projectSlugs, readMemory, writeMemory } from './files'
import { isExempt } from './indexes'
import { git } from './store'

export function recordUse(root: string, reads: string[], day: string): number {
  let n = 0
  const seen = new Set<string>()
  for (const p of reads) {
    const rel = relative(root, p)
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || seen.has(rel.toLowerCase())) continue
    seen.add(rel.toLowerCase())
    const m = readMemory(join(root, rel))
    if (!m) continue
    m.meta.used = day
    m.meta.uses += 1
    writeMemory(m)
    n++
  }
  return n
}

// user and feedback memories describe the person, not the project, so they always live globally.
export function promote(root: string): number {
  let n = 0
  for (const slug of projectSlugs(root))
    for (const m of listMemories(join(root, 'projects', slug))) {
      if (m.meta.type !== 'user' && m.meta.type !== 'feedback') continue
      const dest = join(root, 'topics', basename(m.file))
      const existing = readMemory(dest)
      if (!existing || existing.meta.verified <= m.meta.verified) writeMemory({ ...m, file: dest })
      rmSync(m.file)
      n++
    }
  return n
}

export function archive(root: string, day: string): number {
  let n = 0
  for (const m of allMemories(root)) {
    if (isExempt(m.meta) || daysBetween(m.meta.used, day) <= 90) continue
    const dest = join(root, 'archive', relative(root, m.file))
    mkdirSync(dirname(dest), { recursive: true })
    renameSync(m.file, dest)
    n++
  }
  return n
}

export function splitSource(s: string): [string, string] {
  const m = /^(.*)@([0-9a-f]{4,40})$/.exec(s)
  return m ? [m[1], m[2]] : [s, '']
}

export async function lastHash(projectDir: string, file: string): Promise<string> {
  try {
    return (await git(projectDir, 'log', '-1', '--format=%h', '--', file)).trim()
  } catch {
    return ''
  }
}

export const refreshSources = (projectDir: string, sources: string[]): Promise<string[]> =>
  Promise.all(
    sources.map(async s => {
      const [file] = splitSource(s)
      const h = await lastHash(projectDir, file)
      return h ? `${file}@${h}` : file
    })
  )

// The distiller has no shell, so it records paths and we add the commit it saw.
export async function stampSources(root: string, slug: string, projectDir: string): Promise<void> {
  for (const m of listMemories(join(root, 'projects', slug))) {
    if (m.meta.sources.every(s => splitSource(s)[1])) continue
    m.meta.sources = await Promise.all(m.meta.sources.map(async s => (splitSource(s)[1] ? s : (await refreshSources(projectDir, [s]))[0])))
    writeMemory(m)
  }
}

export async function checkSources(root: string): Promise<string[]> {
  const recheck: string[] = []
  for (const slug of projectSlugs(root)) {
    const dir = projectPath(root, slug)
    if (!dir || !existsSync(dir)) continue
    for (const m of listMemories(join(root, 'projects', slug))) {
      if (m.meta.stale) continue
      for (const src of m.meta.sources) {
        const [file, hash] = splitSource(src)
        if (!hash) continue // unstamped: project isn't git-tracked, nothing to compare
        const now = existsSync(join(dir, file)) ? await lastHash(dir, file) : null
        const changed = now === null || (!!now && !now.startsWith(hash) && !hash.startsWith(now))
        if (!changed) continue
        m.meta.stale = true
        writeMemory(m)
        recheck.push(m.file)
        break
      }
    }
  }
  return recheck
}
