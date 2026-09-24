import type { Memory } from './files'

export function distillPrompt(o: { slice: string; globalIndex: string; projectIndex: string; projectDir: string; day: string }): string {
  return `You maintain long-term memory for Claude Code. Your working directory is the memory folder.
Below is part of a recent Claude Code session. Update the memory so future sessions start with what they need, and nothing else.

## Where memories go
- user.md: who the user is (role, expertise, preferences). type: user
- topics/<name>.md: facts that hold across all projects
- ${o.projectDir}/topics/<name>.md: facts about this project only

## File format (exactly this; one fact per file; at most 200 lines)
---
name: <kebab-case, same as the file name>
type: user | feedback | project | reference
summary: <one line, under 100 characters>
sources: [<paths relative to the project root that this fact came from; [] if none>]
verified: ${o.day}
used: ${o.day}
uses: 0
stale: false
pinned: false
---
<the fact; for feedback and project types add **Why:** and **How to apply:** lines>

## Rules
- Save only facts that are non-obvious and will still matter in future sessions. Never save what can be read from the code, git history or CLAUDE.md, or what only mattered to this session.
- Before creating a file, check the indexes and Grep for an existing memory on the same subject. Update it instead of creating a duplicate.
- If the session shows a memory is wrong, rewrite it and set verified to ${o.day}. If it is no longer true at all, delete the file.
- Never store passwords, API keys, tokens, private keys or .env contents.
- If a project fact also holds for another project under projects/, move it to topics/.
- Only create, edit or delete files in the locations above. Never touch INDEX.md, project.json or anything else.
- Finish with one line saying what changed, or "no changes".

## Current global index
${o.globalIndex.trim() || '(empty)'}

## Current project index
${o.projectIndex.trim() || '(empty)'}

## Session excerpt
${o.slice}
`
}

export function recheckPrompt(m: Memory, sources: { file: string; text: string | null }[]): string {
  const files = sources.map(s => `<<<${s.file}>>>\n${s.text ?? '(deleted)'}`).join('\n\n')
  return `RECHECK. A saved memory may be out of date because the files it was based on changed.
Compare it with the current files below. Reply with exactly one of these as the first line:
KEEP (still accurate)
DELETE (no longer true or no longer useful)
REWRITE (needs updating), followed on the next lines by the corrected memory text only, without frontmatter.

## Memory: ${m.meta.name}
${m.body.trim()}

## Current files
${files}
`
}

export function parseVerdict(out: string): { verdict: 'KEEP' | 'DELETE' | 'REWRITE'; body: string } | null {
  const m = /^(KEEP|DELETE|REWRITE)\b.*$/m.exec(out)
  if (!m) return null
  return { verdict: m[1] as 'KEEP' | 'DELETE' | 'REWRITE', body: out.slice(m.index + m[0].length).replace(/^\r?\n/, '') }
}
