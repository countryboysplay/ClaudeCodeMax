// Claude Code hook for ClaudeCodeMax memory, registered only for sessions the app launches
// (via --settings). Dependency-free, and it must never block or fail a session: every error
// ends in a silent exit 0.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const root = process.env.CCM_MEMORY_DIR ?? join(homedir(), '.claudecodemax', 'memory')
const read = f => (existsSync(f) ? readFileSync(f, 'utf8').trim() : '')

try {
  if (process.env.CCM_DISTILLER !== '1' && existsSync(root)) {
    const input = JSON.parse(readFileSync(0, 'utf8'))
    const event = process.argv[2]
    if (event === 'enqueue' && typeof input.transcript_path === 'string')
      appendFileSync(join(root, '.queue'), `${JSON.stringify({ kind: 'distill', transcript: input.transcript_path })}\n`)
    if (event === 'start') {
      // Same folder naming Claude Code uses under ~/.claude/projects.
      const slug = String(input.cwd ?? process.cwd()).replace(/[^a-zA-Z0-9]/g, '-')
      const global = read(join(root, 'INDEX.md'))
      const project = read(join(root, 'projects', slug, 'INDEX.md'))
      if (global || project) {
        const out = [
          `Memory lives in ${root}. Paths below are relative to it. Read a memory file when its line is relevant; Grep the folder for anything else.`,
          global && `Global memory:\n${global}`,
          project && `Project memory:\n${project}`
        ]
          .filter(Boolean)
          .join('\n\n')
        process.stdout.write(`${out}\n`)
        writeFileSync(join(root, '.injected'), String(Buffer.byteLength(out)))
      }
    }
  }
} catch {
  // never break the session
}
process.exit(0)
