import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { git } from './memory/store'
import type { Deferred } from '../shared/types'

const MAX_FILES = 20_000
const MAX_BYTES = 1 << 20
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.venv'])
// A marker only counts after a comment opener, so prose or strings that mention TODO aren't listed.
const MARK = /(?:\/\/|#|\/\*|<!--|--|^\s*\*)\s*(shortcut:|ponytail:|TODO\b|FIXME\b):?\s*(.*)$/

export const hasReason = (text: string): boolean =>
  /, | — | - /.test(text) || /\b(because|since|until|so that|to avoid|when)\b/i.test(text)

async function listFiles(dir: string): Promise<string[]> {
  try {
    return (await git(dir, 'ls-files', '-z', '--cached', '--others', '--exclude-standard')).split('\0').filter(Boolean)
  } catch {
    // not a git repo, or git missing: walk the folder instead
    const out: string[] = []
    const walk = (rel: string): void => {
      for (const d of readdirSync(join(dir, rel), { withFileTypes: true })) {
        if (out.length > MAX_FILES) return
        const p = rel ? `${rel}/${d.name}` : d.name
        if (d.isDirectory()) {
          if (!SKIP_DIRS.has(d.name)) walk(p)
        } else if (d.isFile()) out.push(p)
      }
    }
    walk('')
    return out
  }
}

export async function scanDeferred(dir: string): Promise<{ deferred: Deferred[]; scanCapped: boolean }> {
  // git ls-files --others lists untracked node_modules etc. unless they're gitignored, so filter both ways.
  const files = (await listFiles(dir)).filter(f => !f.split(/[\\/]/).some(p => SKIP_DIRS.has(p)))
  const deferred: Deferred[] = []
  for (const file of files.slice(0, MAX_FILES)) {
    let buf: Buffer
    try {
      const full = join(dir, file)
      if (statSync(full).size > MAX_BYTES) continue
      buf = readFileSync(full)
    } catch {
      continue // deleted since it was listed, or unreadable
    }
    if (buf.subarray(0, 8000).includes(0)) continue // binary
    buf
      .toString('utf8')
      .split(/\r?\n/)
      .forEach((line, i) => {
        const m = MARK.exec(line)
        if (!m) return
        const text = m[2].replace(/\s*(\*\/|-->)\s*$/, '').trim()
        deferred.push({ file: file.replace(/\\/g, '/'), line: i + 1, marker: m[1].replace(/:$/, ''), text, reason: hasReason(text) })
      })
  }
  // Stable sort: items with no reason first, otherwise in file order.
  deferred.sort((a, b) => Number(a.reason) - Number(b.reason))
  return { deferred, scanCapped: files.length > MAX_FILES }
}
