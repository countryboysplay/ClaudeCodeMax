import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readMemory } from './files'
import { git } from './store'

// Whole token shapes, not bare prefixes: "risk-free" must not trip the scan.
export const SECRET =
  /\bsk-[A-Za-z0-9_-]{20,}|\bghp_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}|\bAKIA[0-9A-Z]{16}\b|\bxox[bp]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/
const ALLOWED = /^(user\.md|topics\/[^/]+\.md|projects\/[^/]+\/topics\/[^/]+\.md)$/

export async function changedFiles(root: string): Promise<string[]> {
  const out = await git(root, 'status', '--porcelain', '-uall', '-z')
  return out.split('\0').filter(Boolean).map(e => e.slice(3))
}

export function problems(root: string, files: string[]): string[] {
  const out: string[] = []
  for (const f of files) {
    const full = join(root, f)
    if (!existsSync(full)) continue // deleting a memory is allowed
    if (!ALLOWED.test(f)) {
      out.push(`${f}: not a memory file location`)
      continue
    }
    const text = readFileSync(full, 'utf8')
    if (SECRET.test(text)) out.push(`${f}: looks like it contains a secret`)
    if (!readMemory(full)) out.push(`${f}: missing or invalid frontmatter`)
    if (text.split('\n').length > 200) out.push(`${f}: over 200 lines`)
  }
  return out
}

export async function rollback(root: string): Promise<void> {
  await git(root, 'checkout', '--', '.')
  await git(root, 'clean', '-fdq')
}
