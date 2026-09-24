# Persistent Memory, Phase 1 (Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude sessions launched by ClaudeCodeMax start with a small, capped memory index and have new sessions distilled into a markdown memory tree automatically. Stale memories are flagged, re-checked and decayed.

**Architecture:**
- A dependency-free hook script (`resources/memory-hook.mjs`), registered via `claude --settings`, does two jobs: it injects the indexes at SessionStart and queues transcripts at SessionEnd and PreCompact.
- A runner in the Electron main process (`src/main/memory/`) drains the queue:
  1. slices each transcript;
  2. runs `claude -p` on Haiku inside the memory folder;
  3. validates the result, rolling back when it fails;
  4. regenerates the indexes in code;
  5. commits to the memory folder's own git repo.

**Tech stack:** TypeScript, Electron main process, Node `child_process`/`fs`, git CLI, vitest, Playwright smoke test. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-24-persistent-memory-design.md` (phase 1 = §2–§5, the project-folder part of §7, and §10 phase 1).

## Global Constraints

- **Platform:** Windows 11 only. Node.js 22.13+ and git are on PATH (the setup wizard guarantees both).
- **Dependencies:** none added.
- **Scope of wiring:** memory never writes `CLAUDE.md` or `~/.claude/settings.json`. Hooks and `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` apply only to sessions ClaudeCodeMax launches.
- **Memory root:** `~/.claudecodemax/memory/`, overridable with `CCM_MEMORY_DIR`.
- **Test seams:**
  - `CCM_CLAUDE_PROJECTS` overrides `~/.claude/projects`.
  - `CCM_CMD_DISTILLER` overrides the `claude` command used by the runner.
- **Defaults:** model `claude-haiku-4-5-20251001`, daily cap 30 runs, index cap 60 lines.
- **Limits:**
  - topic files ≤ 200 lines;
  - slice ≤ 80,000 chars (~20k tokens); slices under 8,000 chars (~2k tokens) are skipped;
  - distiller timeout 5 minutes;
  - decay: 30 days to leave the index, 90 days to move to `archive/`. `user`, `feedback` and `pinned` memories are exempt.
- **Memory types:** `user | feedback | project | reference`.
- **Git identity:** memory commits use `-c user.name=ClaudeCodeMax -c user.email=memory@claudecodemax.local`, so they never depend on the user's git config.

**Interpretations of the spec, made while planning. Each is small and deliberate:**
- **Index cap split:** the 60-line cap is split 40/60 between the global index (24 lines) and each project index (36 lines). That keeps the combined injection ≤ 60 lines without the hook having to rank lines.
- **Secret scan:** it matches full token shapes (e.g. `ghp_` + 30 or more characters), not bare prefixes. A bare `sk-` would flag ordinary words like "risk-".
- **Source hashes:** the distiller has no shell, so it writes source paths only. The runner stamps `@<hash>` on them afterwards.
- **Re-checks:** these answer on stdout (`KEEP` / `DELETE` / `REWRITE`) and the runner applies the change. The model gets no write access for re-checks.
- **Hook-merge check:** the spec's "smoke test with a user-level hook" can't run against the fake Claude CLI. It becomes a manual check with `/hooks` in Task 13.

## Review Focus

- **Transcript still being written** (the last line is partial): only complete lines are consumed, and the offset stops before the partial line. Tested in Task 4.
- **Transcript shrank or was replaced** (saved offset > file size): slicing restarts at 0 instead of reading nothing forever. Tested in Task 4.
- **First launch on a machine with months of transcripts:** nothing is queued. Existing transcripts are marked as seen, and history arrives through the auto-memory import. Tested in Task 10.
- **Ordinary words that resemble key prefixes** ("risk-free", "task-list"): not flagged as secrets. Tested in Task 6.
- **Hook with no memory folder, garbage stdin, or running inside the distiller:** exits 0 with no output, so the session is unaffected. Tested in Task 9.
- **A memory edited by hand before a distill that then fails validation:** the hand edit survives the rollback. Tested in Task 10.

---

## File structure

| File | Responsibility |
|---|---|
| `src/main/run.ts` (modify) | `runShell` gains `cwd`, `env`, `input` (stdin) and `timeoutMs` options |
| `src/main/memory/files.ts` | Paths, slugs, dates, frontmatter parse and serialize, reading and listing memories, `project.json` |
| `src/main/memory/indexes.ts` | Ranking, decay test, `INDEX.md` generation |
| `src/main/memory/transcript.ts` | Incremental transcript slicing |
| `src/main/memory/store.ts` | Git helper, repo init and commit, `.state.json`, `.queue` |
| `src/main/memory/validate.ts` | Allowed paths, frontmatter and size checks, secret scan, rollback |
| `src/main/memory/maintain.ts` | Use tracking, promotion, archiving, source hashes and stale detection |
| `src/main/memory/import.ts` | One-time import of Claude Code auto-memory |
| `src/main/memory/prompts.ts` | Distill and re-check prompts; verdict parsing |
| `src/main/memory/runner.ts` | `MemoryRunner`: queue draining, the distill and re-check jobs, catch-up, maintenance |
| `resources/memory-hook.mjs` | The hook script (`start` / `enqueue`) |
| `src/main/settings.ts` (modify) | `memory: { model, dailyCap, indexCap }` |
| `src/main/index.ts` (modify) | Writes `ccm-hooks.json`; launch args and env; starts and stops the runner; `service:log` for `memory` |
| `electron-builder.yml` (modify) | Ships `memory-hook.mjs` as an extra resource |
| `test/fixtures/fake-distiller.mjs` | Stand-in for `claude -p` in tests |
| `test/fixtures/fake-claude.mjs` (modify) | Prints its args and the auto-memory env var for the smoke test |

---

### Task 1: `runShell` options

**Files:**
- Modify: `src/main/run.ts`
- Test: `test/run.test.ts`

**Interfaces:**
- Produces: `interface RunOpts { cwd?: string; env?: NodeJS.ProcessEnv; input?: string; timeoutMs?: number }` and `type Runner = (command: string, onLine?: (line: string) => void, opts?: RunOpts) => Promise<{ code: number; output: string }>`. Existing callers are unchanged.
- Other consumers (from the graphify graph, `graphify-out/graph.json`): `check()` and `install()` in `src/main/setup.ts`, `fakeRunner` in `test/setup.test.ts`, and `registerIpc()` at `src/main/index.ts:222`. The new third parameter is optional, so they compile unchanged.

- [ ] **Step 1: Write the failing tests.** Append inside the `describe('runShell')` block in `test/run.test.ts`, and extend the imports:

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
```

```ts
  it('passes cwd, env and stdin', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ccm-run-'))
    const r = await runShell(
      'node -e "process.stdin.pipe(process.stdout); console.log(require(\'path\').basename(process.cwd()), process.env.CCM_X)"',
      undefined,
      { cwd: dir, env: { ...process.env, CCM_X: 'env-ok' }, input: 'stdin-ok' }
    )
    expect(r.code).toBe(0)
    expect(r.output).toContain(basename(dir))
    expect(r.output).toContain('env-ok')
    expect(r.output).toContain('stdin-ok')
  })
  it('kills the command after timeoutMs', async () => {
    const t = Date.now()
    const r = await runShell('ping -n 30 127.0.0.1', undefined, { timeoutMs: 500 })
    expect(r.code).not.toBe(0)
    expect(Date.now() - t).toBeLessThan(10_000)
  }, 15_000)
```

- [ ] **Step 2: Run the tests to confirm they fail.**
  Run: `npx vitest run test/run.test.ts`
  Expected: both new tests FAIL. The first gets no `stdin-ok` and runs in the wrong cwd; the second runs for ~30s and hits the test timeout.

- [ ] **Step 3: Implement.** Replace the top of `src/main/run.ts`, up to the end of `runShell`, with:

```ts
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'

export interface RunOpts {
  cwd?: string
  env?: NodeJS.ProcessEnv
  input?: string
  timeoutMs?: number
}

export type Runner = (
  command: string,
  onLine?: (line: string) => void,
  opts?: RunOpts
) => Promise<{ code: number; output: string }>

const running = new Set<ChildProcess>()

export const runShell: Runner = (command, onLine, opts = {}) =>
  new Promise(resolve => {
    const child = spawn(command, { shell: true, windowsHide: true, env: opts.env ?? process.env, cwd: opts.cwd })
    running.add(child)
    const timer = opts.timeoutMs ? setTimeout(() => killTree(child.pid), opts.timeoutMs) : undefined
    if (opts.input !== undefined) child.stdin?.end(opts.input)
    let output = ''
    let partial = ''
    const feed = (buf: Buffer) => {
      const text = buf.toString()
      output += text
      const parts = (partial + text).split(/\r?\n/)
      partial = parts.pop() ?? ''
      for (const p of parts) if (p.trim()) onLine?.(p)
    }
    child.stdout?.on('data', feed)
    child.stderr?.on('data', feed)
    const done = (code: number) => {
      clearTimeout(timer)
      running.delete(child)
      if (partial.trim()) onLine?.(partial)
      resolve({ code, output })
    }
    child.on('error', err => done((output += String(err), -1)))
    child.on('close', code => done(code ?? -1))
  })
```

`killTree` and `killAll` stay as they are.

- [ ] **Step 4: Run the tests and typecheck.**
  Run: `npx vitest run test/run.test.ts && npm run typecheck`
  Expected: all PASS, no type errors.

- [ ] **Step 5: Commit.**

```bash
git add src/main/run.ts test/run.test.ts
git commit -m "feat(run): cwd, env, stdin and timeout options for runShell"
```

---

### Task 2: Memory files — paths, slugs, frontmatter

**Files:**
- Create: `src/main/memory/files.ts`
- Test: `test/memory-files.test.ts`

**Interfaces:**
- Produces (all exported from `src/main/memory/files.ts`):
  - **Paths and dates:**
    - `memDir(): string`
    - `claudeProjectsDir(): string`
    - `slugFor(dir: string): string`
    - `today(): string` (`YYYY-MM-DD`)
    - `daysBetween(from: string, to: string): number`
  - **Types:**
    - `type MemoryType`
    - `TYPES: MemoryType[]`
    - `interface Meta { name; type; summary; sources: string[]; verified; used; uses: number; stale: boolean; pinned: boolean }`
    - `interface Memory { file: string; meta: Meta; body: string }` (`file` is an absolute path)
  - **Frontmatter:**
    - `parseFrontmatter(text): { raw: Record<string, unknown>; body: string } | null`
    - `toMeta(raw): Meta | null`
    - `serialize(meta, body): string`
  - **Reading and writing memories:**
    - `readMemory(file): Memory | null`
    - `writeMemory(m: Memory): void`
    - `listMemories(scopeDir): Memory[]` (reads `user.md` if present, plus `topics/*.md`)
  - **Projects:**
    - `projectSlugs(root): string[]`
    - `allMemories(root): Memory[]`
    - `projectPath(root, slug): string | null`
    - `writeProject(root, slug, path): void`

- [ ] **Step 1: Write the failing tests.** Create `test/memory-files.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  allMemories, daysBetween, listMemories, parseFrontmatter, projectPath, readMemory, serialize, slugFor,
  toMeta, writeMemory, writeProject, type Meta
} from '../src/main/memory/files'

const meta = (over: Partial<Meta> = {}): Meta => ({
  name: 'release-flow', type: 'project', summary: 'tag v* then publish', sources: ['a.ts@abc1234'],
  verified: '2026-09-24', used: '2026-09-24', uses: 3, stale: false, pinned: false, ...over
})

describe('slugFor', () => {
  it('matches Claude Code project folder names', () =>
    expect(slugFor('C:\\Users\\jonat\\OneDrive\\Desktop\\Claude Terminal')).toBe('C--Users-jonat-OneDrive-Desktop-Claude-Terminal'))
})

describe('daysBetween', () => {
  it('counts whole days', () => expect(daysBetween('2026-09-01', '2026-09-24')).toBe(23))
})

describe('frontmatter', () => {
  it('round-trips through serialize and parse', () => {
    const text = serialize(meta(), 'Body line\n')
    const p = parseFrontmatter(text)!
    expect(toMeta(p.raw)).toEqual(meta())
    expect(p.body).toBe('Body line\n')
  })
  it('parses CRLF files', () => {
    const p = parseFrontmatter(serialize(meta(), 'x\n').replace(/\n/g, '\r\n'))!
    expect(toMeta(p.raw)?.name).toBe('release-flow')
  })
  it('returns null without frontmatter', () => expect(parseFrontmatter('just text')).toBeNull())
  it('rejects a missing summary or an unknown type', () => {
    expect(toMeta({ name: 'a', type: 'project', verified: '2026-09-24' })).toBeNull()
    expect(toMeta({ name: 'a', type: 'nope', summary: 's', verified: '2026-09-24' })).toBeNull()
  })
  it('fills defaults for optional fields', () =>
    expect(toMeta({ name: 'a', type: 'user', summary: 's', verified: '2026-09-01' })).toEqual({
      name: 'a', type: 'user', summary: 's', sources: [], verified: '2026-09-01', used: '2026-09-01',
      uses: 0, stale: false, pinned: false
    }))
  it('reads an empty list as []', () => expect(parseFrontmatter('---\nsources: []\n---\n')!.raw.sources).toEqual([]))
})

describe('listing', () => {
  it('reads user.md and topics, skipping invalid files', () => {
    const root = mkdtempSync(join(tmpdir(), 'ccm-mem-'))
    writeMemory({ file: join(root, 'user.md'), meta: meta({ name: 'user', type: 'user' }), body: '' })
    writeMemory({ file: join(root, 'topics', 'a.md'), meta: meta({ name: 'a' }), body: '' })
    writeFileSync(join(root, 'topics', 'broken.md'), 'no frontmatter')
    writeMemory({ file: join(root, 'projects', 'P', 'topics', 'b.md'), meta: meta({ name: 'b' }), body: '' })
    expect(listMemories(root).map(m => m.meta.name).sort()).toEqual(['a', 'user'])
    expect(allMemories(root).map(m => m.meta.name).sort()).toEqual(['a', 'b', 'user'])
    expect(readMemory(join(root, 'topics', 'missing.md'))).toBeNull()
  })
  it('stores and reads project.json', () => {
    const root = mkdtempSync(join(tmpdir(), 'ccm-mem-'))
    mkdirSync(join(root, 'projects'), { recursive: true })
    expect(projectPath(root, 'P')).toBeNull()
    writeProject(root, 'P', 'C:\\code\\p')
    expect(projectPath(root, 'P')).toBe('C:\\code\\p')
  })
})
```

- [ ] **Step 2: Run the tests to confirm they fail.**
  Run: `npx vitest run test/memory-files.test.ts`
  Expected: FAIL, "Cannot find module '../src/main/memory/files'".

- [ ] **Step 3: Implement.** Create `src/main/memory/files.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests and typecheck.**
  Run: `npx vitest run test/memory-files.test.ts && npm run typecheck`
  Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/main/memory/files.ts test/memory-files.test.ts
git commit -m "feat(memory): memory file format, paths and listing"
```

---

### Task 3: Index generation

**Files:**
- Create: `src/main/memory/indexes.ts`
- Test: `test/memory-indexes.test.ts`

**Interfaces:**
- Consumes from Task 2: `Memory`, `Meta`, `listMemories`, `projectSlugs`, `daysBetween`.
- Produces:
  - `splitCap(cap: number): { global: number; project: number }`
  - `isExempt(m: Meta): boolean`
  - `isDecayed(m: Meta, day: string): boolean`
  - `renderIndex(root: string, mems: Memory[], cap: number, day: string): string`
  - `rebuildIndexes(root: string, cap: number, day: string): void`

- [ ] **Step 1: Write the failing tests.** Create `test/memory-indexes.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeMemory, type Memory, type Meta } from '../src/main/memory/files'
import { isDecayed, rebuildIndexes, renderIndex, splitCap } from '../src/main/memory/indexes'

const root = 'C:\\mem'
const mem = (name: string, over: Partial<Meta> = {}, file = join(root, 'topics', `${name}.md`)): Memory => ({
  file,
  body: '',
  meta: { name, type: 'project', summary: `about ${name}`, sources: [], verified: '2026-09-20', used: '2026-09-20', uses: 0, stale: false, pinned: false, ...over }
})
const DAY = '2026-09-24'

describe('renderIndex', () => {
  it('orders pinned, then user/feedback, then most recently used', () => {
    const out = renderIndex(root, [
      mem('old', { used: '2026-09-01' }),
      mem('new', { used: '2026-09-23' }),
      mem('pref', { type: 'feedback', used: '2026-08-01' }),
      mem('pin', { pinned: true, used: '2026-08-01' })
    ], 10, DAY)
    expect(out.split('\n').filter(Boolean).map(l => /\[(.+?)\]/.exec(l)![1])).toEqual(['pin', 'pref', 'new', 'old'])
  })
  it('writes forward-slash paths relative to the memory root, and flags stale entries', () => {
    const out = renderIndex(root, [mem('a', { stale: true }, join(root, 'projects', 'P', 'topics', 'a.md'))], 10, DAY)
    expect(out).toBe('- [a](projects/P/topics/a.md) — about a (may be stale)\n')
  })
  it('applies the cap', () => {
    const out = renderIndex(root, ['a', 'b', 'c'].map(n => mem(n)), 2, DAY)
    expect(out.trim().split('\n')).toHaveLength(2)
  })
  it('omits decayed entries but keeps exempt ones', () => {
    const out = renderIndex(root, [mem('gone', { used: '2026-08-01' }), mem('me', { type: 'user', used: '2026-01-01' })], 10, DAY)
    expect(out).not.toContain('gone')
    expect(out).toContain('me')
  })
  it('is empty when there is nothing to show', () => expect(renderIndex(root, [], 10, DAY)).toBe(''))
})

describe('isDecayed and splitCap', () => {
  it('decays after 30 unused days', () => {
    expect(isDecayed(mem('a', { used: '2026-08-25' }).meta, DAY)).toBe(false)
    expect(isDecayed(mem('a', { used: '2026-08-24' }).meta, DAY)).toBe(true)
  })
  it('splits the cap 40/60 between global and project', () => expect(splitCap(60)).toEqual({ global: 24, project: 36 }))
})

describe('rebuildIndexes', () => {
  it('writes the global and per-project INDEX.md files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ccm-idx-'))
    writeMemory(mem('g', {}, join(dir, 'topics', 'g.md')))
    writeMemory(mem('p', {}, join(dir, 'projects', 'P', 'topics', 'p.md')))
    rebuildIndexes(dir, 60, DAY)
    expect(readFileSync(join(dir, 'INDEX.md'), 'utf8')).toContain('[g](topics/g.md)')
    expect(readFileSync(join(dir, 'projects', 'P', 'INDEX.md'), 'utf8')).toContain('[p](projects/P/topics/p.md)')
  })
})
```

- [ ] **Step 2: Run the tests to confirm they fail.**
  Run: `npx vitest run test/memory-indexes.test.ts`
  Expected: FAIL, module not found.

- [ ] **Step 3: Implement.** Create `src/main/memory/indexes.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests and typecheck.**
  Run: `npx vitest run test/memory-indexes.test.ts && npm run typecheck`
  Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/main/memory/indexes.ts test/memory-indexes.test.ts
git commit -m "feat(memory): generate capped, ranked memory indexes"
```

---

### Task 4: Transcript slicing

**Files:**
- Create: `src/main/memory/transcript.ts`
- Test: `test/memory-transcript.test.ts`

**Interfaces:**
- Produces:
  - `interface Slice { text: string; end: number; reads: string[]; cwd: string | null }`
  - `sliceTranscript(file: string, offset: number, maxChars?: number): Slice`
  - `end` is the byte offset to save next.
  - `reads` holds the absolute `file_path`s of `Read` tool calls.

- [ ] **Step 1: Write the failing tests.** Create `test/memory-transcript.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { appendFileSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sliceTranscript } from '../src/main/memory/transcript'

const dir = mkdtempSync(join(tmpdir(), 'ccm-tr-'))
const line = (o: object) => `${JSON.stringify(o)}\n`
const user = (content: unknown, extra = {}) => line({ type: 'user', cwd: 'C:\\code\\p', message: { role: 'user', content }, ...extra })
const assistant = (content: unknown[]) => line({ type: 'assistant', message: { role: 'assistant', content } })

describe('sliceTranscript', () => {
  it('keeps user and assistant text, names tools, drops tool output and meta', () => {
    const f = join(dir, 'a.jsonl')
    writeFileSync(f,
      user('please fix the release') +
      user([{ type: 'text', text: 'skill text' }], { isMeta: true }) +
      assistant([{ type: 'text', text: 'on it' }, { type: 'tool_use', name: 'Read', input: { file_path: 'C:\\mem\\topics\\a.md' } }, { type: 'tool_use', name: 'Bash', input: { command: 'ls' } }]) +
      user([{ type: 'tool_result', content: 'HUGE OUTPUT' }]) +
      line({ type: 'system', content: 'x' }))
    const s = sliceTranscript(f, 0)
    expect(s.text).toBe('USER: please fix the release\nCLAUDE: on it\nTOOL: Read C:\\mem\\topics\\a.md\nTOOL: Bash')
    expect(s.reads).toEqual(['C:\\mem\\topics\\a.md'])
    expect(s.cwd).toBe('C:\\code\\p')
    expect(s.end).toBe(statSync(f).size)
  })
  it('resumes from an offset', () => {
    const f = join(dir, 'b.jsonl')
    writeFileSync(f, user('first'))
    const a = sliceTranscript(f, 0)
    appendFileSync(f, user('second'))
    expect(sliceTranscript(f, a.end).text).toBe('USER: second')
  })
  it('stops before a partial last line', () => {
    const f = join(dir, 'c.jsonl')
    const whole = user('done')
    writeFileSync(f, `${whole}{"type":"user","mess`)
    const s = sliceTranscript(f, 0)
    expect(s.text).toBe('USER: done')
    expect(s.end).toBe(Buffer.byteLength(whole))
  })
  it('restarts at 0 when the file shrank below the offset', () => {
    const f = join(dir, 'd.jsonl')
    writeFileSync(f, user('fresh'))
    expect(sliceTranscript(f, 1_000_000).text).toBe('USER: fresh')
  })
  it('keeps the newest maxChars', () => {
    const f = join(dir, 'e.jsonl')
    writeFileSync(f, user('a'.repeat(50)) + user('b'.repeat(50)))
    const s = sliceTranscript(f, 0, 20)
    expect(s.text).toBe('b'.repeat(20))
  })
})
```

- [ ] **Step 2: Run the tests to confirm they fail.**
  Run: `npx vitest run test/memory-transcript.test.ts`
  Expected: FAIL, module not found.

- [ ] **Step 3: Implement.** Create `src/main/memory/transcript.ts`:

```ts
import { closeSync, openSync, readSync, statSync } from 'node:fs'

export interface Slice {
  text: string
  end: number
  reads: string[]
  cwd: string | null
}

const PATH_TOOLS = ['Read', 'Edit', 'Write']

// Reads the transcript from `offset`, keeping what a person said and what Claude said.
// Tool output is dropped: it's most of the tokens and none of the lasting value.
export function sliceTranscript(file: string, offset: number, maxChars = 80_000): Slice {
  const size = statSync(file).size
  const start = offset > size ? 0 : offset
  const buf = Buffer.alloc(size - start)
  const fd = openSync(file, 'r')
  try {
    readSync(fd, buf, 0, buf.length, start)
  } finally {
    closeSync(fd)
  }
  const complete = buf.lastIndexOf(0x0a) + 1 // a partial last line is left for next time
  const parts: string[] = []
  const reads: string[] = []
  let cwd: string | null = null
  for (const raw of buf.subarray(0, complete).toString('utf8').split('\n')) {
    let o: any
    try {
      o = JSON.parse(raw)
    } catch {
      continue
    }
    if (!cwd && typeof o.cwd === 'string') cwd = o.cwd
    if (o.isMeta || o.isSidechain) continue
    const c = o.message?.content
    if (o.type === 'user') {
      if (typeof c === 'string') parts.push(`USER: ${c}`)
      else if (Array.isArray(c)) for (const b of c) if (b?.type === 'text') parts.push(`USER: ${b.text}`)
    } else if (o.type === 'assistant' && Array.isArray(c)) {
      for (const b of c) {
        if (b?.type === 'text') parts.push(`CLAUDE: ${b.text}`)
        if (b?.type !== 'tool_use') continue
        const p = typeof b.input?.file_path === 'string' ? (b.input.file_path as string) : null
        if (b.name === 'Read' && p) reads.push(p)
        parts.push(`TOOL: ${b.name}${p && PATH_TOOLS.includes(b.name) ? ` ${p}` : ''}`)
      }
    }
  }
  const text = parts.join('\n')
  return { text: text.length > maxChars ? text.slice(-maxChars) : text, end: start + complete, reads, cwd }
}
```

- [ ] **Step 4: Run the tests and typecheck.**
  Run: `npx vitest run test/memory-transcript.test.ts && npm run typecheck`
  Expected: PASS. If `any` trips a lint rule, keep it: the transcript schema is external and untyped.

- [ ] **Step 5: Commit.**

```bash
git add src/main/memory/transcript.ts test/memory-transcript.test.ts
git commit -m "feat(memory): incremental transcript slicing"
```

---

### Task 5: Repo, state and queue

**Files:**
- Create: `src/main/memory/store.ts`
- Test: `test/memory-store.test.ts`

**Interfaces:**
- Produces:
  - **Git:**
    - `git(cwd: string, ...args: string[]): Promise<string>` returns raw stdout; callers trim.
    - `ensureRepo(root): Promise<void>`
    - `commit(root, message): Promise<boolean>` returns `false` when there was nothing to commit.
  - **Paths:** `pathKey(p: string): string`, a normalized absolute, lower-cased path used for offsets and dedupe.
  - **State:**
    - `interface MemState { offsets: Record<string, number>; runs: { day: string; count: number }; imported: boolean }`
    - `readState(root): MemState`
    - `writeState(root, s): void`
  - **Queue:**
    - `type Job = { kind: 'distill'; transcript: string } | { kind: 'recheck'; file: string }`
    - `readQueue(root): Job[]` is deduped and skips bad lines.
    - `enqueue(root, job): void`
    - `removeJob(root, job): void`

- [ ] **Step 1: Write the failing tests.** Create `test/memory-store.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commit, enqueue, ensureRepo, git, readQueue, readState, removeJob, writeState } from '../src/main/memory/store'

const fresh = () => mkdtempSync(join(tmpdir(), 'ccm-store-'))

describe('repo', () => {
  it('initialises once, ignoring machine-local files', async () => {
    const root = fresh()
    await ensureRepo(root)
    await ensureRepo(root)
    expect(existsSync(join(root, '.git'))).toBe(true)
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe('.state.json\n.queue\n.injected\n')
    expect((await git(root, 'log', '--oneline')).trim().split('\n')).toHaveLength(1)
  })
  it('commits only when something changed', async () => {
    const root = fresh()
    await ensureRepo(root)
    expect(await commit(root, 'nothing')).toBe(false)
    writeFileSync(join(root, 'topics', 'a.md'), 'x')
    writeFileSync(join(root, '.state.json'), '{}')
    expect(await commit(root, 'add a')).toBe(true)
    expect((await git(root, 'status', '--porcelain')).trim()).toBe('')
  })
})

describe('state', () => {
  it('falls back to defaults when missing or corrupt', () => {
    const root = fresh()
    expect(readState(root)).toEqual({ offsets: {}, runs: { day: '', count: 0 }, imported: false })
    writeFileSync(join(root, '.state.json'), '{bad')
    expect(readState(root).imported).toBe(false)
  })
  it('round-trips', () => {
    const root = fresh()
    writeState(root, { offsets: { a: 5 }, runs: { day: '2026-09-24', count: 2 }, imported: true })
    expect(readState(root)).toEqual({ offsets: { a: 5 }, runs: { day: '2026-09-24', count: 2 }, imported: true })
  })
})

describe('queue', () => {
  it('dedupes by normalized path and skips bad lines', () => {
    const root = fresh()
    enqueue(root, { kind: 'distill', transcript: 'C:\\t\\A.jsonl' })
    appendFileSync(join(root, '.queue'), 'not json\n{"kind":"other"}\n')
    enqueue(root, { kind: 'distill', transcript: 'c:/t/a.jsonl' })
    enqueue(root, { kind: 'recheck', file: 'C:\\m\\x.md' })
    expect(readQueue(root)).toEqual([
      { kind: 'distill', transcript: 'C:\\t\\A.jsonl' },
      { kind: 'recheck', file: 'C:\\m\\x.md' }
    ])
  })
  it('removes one job and keeps the rest', () => {
    const root = fresh()
    enqueue(root, { kind: 'distill', transcript: 'C:\\t\\a.jsonl' })
    enqueue(root, { kind: 'distill', transcript: 'C:\\t\\b.jsonl' })
    removeJob(root, { kind: 'distill', transcript: 'C:\\t\\a.jsonl' })
    expect(readQueue(root)).toEqual([{ kind: 'distill', transcript: 'C:\\t\\b.jsonl' }])
  })
  it('is empty when the file is missing', () => expect(readQueue(fresh())).toEqual([]))
})
```

- [ ] **Step 2: Run the tests to confirm they fail.**
  Run: `npx vitest run test/memory-store.test.ts`
  Expected: FAIL, module not found.

- [ ] **Step 3: Implement.** Create `src/main/memory/store.ts`:

```ts
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
}

export function readState(root: string): MemState {
  const d: MemState = { offsets: {}, runs: { day: '', count: 0 }, imported: false }
  try {
    const v = JSON.parse(readFileSync(join(root, '.state.json'), 'utf8'))
    return {
      offsets: v.offsets && typeof v.offsets === 'object' ? v.offsets : d.offsets,
      runs: typeof v.runs?.day === 'string' && typeof v.runs?.count === 'number' ? v.runs : d.runs,
      imported: v.imported === true
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
```

- [ ] **Step 4: Run the tests and typecheck.**
  Run: `npx vitest run test/memory-store.test.ts && npm run typecheck`
  Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/main/memory/store.ts test/memory-store.test.ts
git commit -m "feat(memory): git-backed memory repo, state and job queue"
```

---

### Task 6: Validation and rollback

**Files:**
- Create: `src/main/memory/validate.ts`
- Test: `test/memory-validate.test.ts`

**Interfaces:**
- Consumes: `git` (Task 5) and `readMemory` (Task 2).
- Produces:
  - `SECRET: RegExp`
  - `changedFiles(root): Promise<string[]>` returns repo-relative paths with forward slashes, including deleted files.
  - `problems(root, files): string[]` returns an empty array when everything is fine.
  - `rollback(root): Promise<void>`

- [ ] **Step 1: Write the failing tests.** Create `test/memory-validate.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serialize, type Meta } from '../src/main/memory/files'
import { commit, ensureRepo } from '../src/main/memory/store'
import { SECRET, changedFiles, problems, rollback } from '../src/main/memory/validate'

const meta: Meta = { name: 'a', type: 'project', summary: 's', sources: [], verified: '2026-09-24', used: '2026-09-24', uses: 0, stale: false, pinned: false }
const setup = async () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-val-'))
  await ensureRepo(root)
  return root
}

describe('SECRET', () => {
  it('matches real token shapes', () => {
    for (const s of [`ghp_${'a'.repeat(36)}`, `sk-ant-${'b'.repeat(40)}`, 'AKIAABCDEFGHIJKLMNOP', 'xoxb-1234567890-abc', '-----BEGIN RSA PRIVATE KEY-----'])
      expect(SECRET.test(s), s).toBe(true)
  })
  it('ignores ordinary words that share a prefix', () => {
    for (const s of ['a risk-free change', 'the task-list view', 'ask-me-anything', 'sk-short'])
      expect(SECRET.test(s), s).toBe(false)
  })
})

describe('problems', () => {
  it('accepts valid memory files in allowed places and ignores deletions', async () => {
    const root = await setup()
    mkdirSync(join(root, 'projects', 'P', 'topics'), { recursive: true })
    writeFileSync(join(root, 'topics', 'a.md'), serialize(meta, 'fine\n'))
    writeFileSync(join(root, 'projects', 'P', 'topics', 'b.md'), serialize({ ...meta, name: 'b' }, 'fine\n'))
    const files = await changedFiles(root)
    expect(files.sort()).toEqual(['projects/P/topics/b.md', 'topics/a.md'])
    expect(problems(root, [...files, 'topics/deleted.md'])).toEqual([])
  })
  it('rejects other locations, bad frontmatter, long files and secrets', async () => {
    const root = await setup()
    writeFileSync(join(root, 'notes.txt'), 'x')
    writeFileSync(join(root, 'topics', 'bad.md'), 'no frontmatter')
    writeFileSync(join(root, 'topics', 'long.md'), serialize(meta, 'x\n'.repeat(201)))
    writeFileSync(join(root, 'topics', 'key.md'), serialize(meta, `token ghp_${'a'.repeat(36)}\n`))
    const p = problems(root, await changedFiles(root))
    expect(p.some(x => x.startsWith('notes.txt'))).toBe(true)
    expect(p.some(x => x.startsWith('topics/bad.md'))).toBe(true)
    expect(p.some(x => x.startsWith('topics/long.md'))).toBe(true)
    expect(p.some(x => x.startsWith('topics/key.md'))).toBe(true)
  })
})

describe('rollback', () => {
  it('restores tracked files and removes new ones', async () => {
    const root = await setup()
    writeFileSync(join(root, 'topics', 'keep.md'), 'original')
    await commit(root, 'keep')
    writeFileSync(join(root, 'topics', 'keep.md'), 'changed')
    writeFileSync(join(root, 'topics', 'new.md'), 'new')
    writeFileSync(join(root, '.state.json'), '{}')
    await rollback(root)
    expect(readFileSync(join(root, 'topics', 'keep.md'), 'utf8')).toBe('original')
    expect(existsSync(join(root, 'topics', 'new.md'))).toBe(false)
    expect(existsSync(join(root, '.state.json'))).toBe(true) // ignored files survive
  })
})
```

- [ ] **Step 2: Run the tests to confirm they fail.**
  Run: `npx vitest run test/memory-validate.test.ts`
  Expected: FAIL, module not found.

- [ ] **Step 3: Implement.** Create `src/main/memory/validate.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests and typecheck.**
  Run: `npx vitest run test/memory-validate.test.ts && npm run typecheck`
  Expected: PASS. `long.md` has 201 body lines plus frontmatter, so it's over 200.

- [ ] **Step 5: Commit.**

```bash
git add src/main/memory/validate.ts test/memory-validate.test.ts
git commit -m "feat(memory): validate distiller output and roll back bad runs"
```

---

### Task 7: Maintenance — use, promotion, archive, source checks

**Files:**
- Create: `src/main/memory/maintain.ts`
- Test: `test/memory-maintain.test.ts`

**Interfaces:**
- Consumes:
  - from Task 2: `readMemory`, `writeMemory`, `listMemories`, `allMemories`, `projectSlugs`, `projectPath`, `daysBetween`;
  - from Task 3: `isExempt`;
  - from Task 5: `git`.
- Produces:
  - **Use and placement:**
    - `recordUse(root, reads: string[], day): number`
    - `promote(root): number`
    - `archive(root, day): number`
  - **Sources:**
    - `splitSource(s): [file: string, hash: string]` (`hash` is `''` when absent)
    - `lastHash(projectDir, file): Promise<string>`
    - `refreshSources(projectDir, sources): Promise<string[]>`
    - `stampSources(root, slug, projectDir): Promise<void>`
    - `checkSources(root): Promise<string[]>` returns the absolute files that need a re-check and marks each one `stale`.

- [ ] **Step 1: Write the failing tests.** Create `test/memory-maintain.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readMemory, writeMemory, writeProject, type Meta } from '../src/main/memory/files'
import { archive, checkSources, promote, recordUse, splitSource, stampSources } from '../src/main/memory/maintain'
import { git } from '../src/main/memory/store'

const DAY = '2026-09-24'
const meta = (over: Partial<Meta> = {}): Meta => ({
  name: 'a', type: 'project', summary: 's', sources: [], verified: '2026-09-20', used: '2026-09-20', uses: 0, stale: false, pinned: false, ...over
})
const fresh = (p: string) => mkdtempSync(join(tmpdir(), p))
const gitc = (cwd: string, ...a: string[]) => git(cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a)

async function projectRepo() {
  const dir = fresh('ccm-proj-')
  await git(dir, 'init', '-q')
  writeFileSync(join(dir, 'app.ts'), 'v1')
  await gitc(dir, 'add', '-A')
  await gitc(dir, 'commit', '-q', '-m', 'v1')
  return dir
}

describe('splitSource', () => {
  it('splits a trailing hash only', () => {
    expect(splitSource('src/a.ts@abc1234')).toEqual(['src/a.ts', 'abc1234'])
    expect(splitSource('node_modules/@lydell/x.js')).toEqual(['node_modules/@lydell/x.js', ''])
  })
})

describe('recordUse', () => {
  it('bumps used and uses for memory files that were read, once per slice', () => {
    const root = fresh('ccm-m-')
    const f = join(root, 'topics', 'a.md')
    writeMemory({ file: f, meta: meta(), body: '' })
    expect(recordUse(root, [f, f, 'C:\\elsewhere\\x.md'], DAY)).toBe(1)
    expect(readMemory(f)!.meta).toMatchObject({ used: DAY, uses: 1 })
  })
})

describe('promote', () => {
  it('moves user and feedback memories to global, keeping the newer copy', () => {
    const root = fresh('ccm-m-')
    writeMemory({ file: join(root, 'projects', 'P', 'topics', 'pref.md'), meta: meta({ name: 'pref', type: 'feedback', verified: '2026-09-22' }), body: 'new' })
    writeMemory({ file: join(root, 'topics', 'pref.md'), meta: meta({ name: 'pref', type: 'feedback', verified: '2026-09-01' }), body: 'old' })
    writeMemory({ file: join(root, 'projects', 'P', 'topics', 'fact.md'), meta: meta({ name: 'fact' }), body: '' })
    expect(promote(root)).toBe(1)
    expect(readMemory(join(root, 'topics', 'pref.md'))!.body).toBe('new')
    expect(existsSync(join(root, 'projects', 'P', 'topics', 'pref.md'))).toBe(false)
    expect(existsSync(join(root, 'projects', 'P', 'topics', 'fact.md'))).toBe(true)
  })
})

describe('archive', () => {
  it('moves memories unused for over 90 days, except exempt ones', () => {
    const root = fresh('ccm-m-')
    writeMemory({ file: join(root, 'topics', 'old.md'), meta: meta({ name: 'old', used: '2026-06-01' }), body: '' })
    writeMemory({ file: join(root, 'topics', 'me.md'), meta: meta({ name: 'me', type: 'user', used: '2026-01-01' }), body: '' })
    expect(archive(root, DAY)).toBe(1)
    expect(existsSync(join(root, 'archive', 'topics', 'old.md'))).toBe(true)
    expect(existsSync(join(root, 'topics', 'me.md'))).toBe(true)
  })
})

describe('sources', () => {
  it('stamps hashes, then flags changed and deleted sources once', async () => {
    const proj = await projectRepo()
    const root = fresh('ccm-m-')
    writeProject(root, 'P', proj)
    const f = join(root, 'projects', 'P', 'topics', 'a.md')
    writeMemory({ file: f, meta: meta({ sources: ['app.ts'] }), body: '' })
    await stampSources(root, 'P', proj)
    expect(readMemory(f)!.meta.sources[0]).toMatch(/^app\.ts@[0-9a-f]{7,}$/)
    expect(await checkSources(root)).toEqual([])

    writeFileSync(join(proj, 'app.ts'), 'v2')
    await gitc(proj, 'commit', '-qam', 'v2')
    expect(await checkSources(root)).toEqual([f])
    expect(readMemory(f)!.meta.stale).toBe(true)
    expect(await checkSources(root)).toEqual([]) // already stale, not re-queued

    const g = join(root, 'projects', 'P', 'topics', 'b.md')
    writeMemory({ file: g, meta: meta({ name: 'b', sources: ['gone.ts@abc1234'] }), body: '' })
    expect(await checkSources(root)).toEqual([g])
  })
  it('skips projects whose folder is missing on this machine', async () => {
    const root = fresh('ccm-m-')
    writeProject(root, 'P', 'C:\\no\\such\\dir')
    writeMemory({ file: join(root, 'projects', 'P', 'topics', 'a.md'), meta: meta({ sources: ['x@abc1234'] }), body: '' })
    expect(await checkSources(root)).toEqual([])
    rmSync(root, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Run the tests to confirm they fail.**
  Run: `npx vitest run test/memory-maintain.test.ts`
  Expected: FAIL, module not found.

- [ ] **Step 3: Implement.** Create `src/main/memory/maintain.ts`:

```ts
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
        const now = existsSync(join(dir, file)) ? await lastHash(dir, file) : null
        const changed = now === null || (!!hash && !!now && !now.startsWith(hash) && !hash.startsWith(now))
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
```

- [ ] **Step 4: Run the tests and typecheck.**
  Run: `npx vitest run test/memory-maintain.test.ts && npm run typecheck`
  Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/main/memory/maintain.ts test/memory-maintain.test.ts
git commit -m "feat(memory): use tracking, promotion, archiving and stale-source detection"
```

---

### Task 8: Auto-memory import

**Files:**
- Create: `src/main/memory/import.ts`
- Test: `test/memory-import.test.ts`

**Interfaces:**
- Consumes from Task 2: `TYPES`, `writeMemory`, `MemoryType`.
- Produces: `importAutoMemory(root: string, claudeProjects: string, skipSlug: string): number`.

- [ ] **Step 1: Write the failing tests.** Create `test/memory-import.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readMemory } from '../src/main/memory/files'
import { importAutoMemory } from '../src/main/memory/import'

function claudeHome() {
  const cp = mkdtempSync(join(tmpdir(), 'ccm-cp-'))
  const mem = join(cp, 'C--code-app', 'memory')
  mkdirSync(mem, { recursive: true })
  writeFileSync(join(mem, 'MEMORY.md'), '- [x](x.md)')
  writeFileSync(join(mem, 'prefers-short.md'), '---\nname: prefers-short\ndescription: likes terse answers\nmetadata:\n  type: feedback\n---\nKeep it short.\n')
  writeFileSync(join(mem, 'plain.md'), '\nRelease on Fridays.\nMore.\n')
  mkdirSync(join(cp, 'SKIP', 'memory'), { recursive: true })
  writeFileSync(join(cp, 'SKIP', 'memory', 'z.md'), 'z')
  return cp
}

describe('importAutoMemory', () => {
  it('converts auto-memory files into project memories, once', () => {
    const cp = claudeHome()
    const root = mkdtempSync(join(tmpdir(), 'ccm-mem-'))
    expect(importAutoMemory(root, cp, 'SKIP')).toBe(2)
    const a = readMemory(join(root, 'projects', 'C--code-app', 'topics', 'prefers-short.md'))!
    expect(a.meta).toMatchObject({ name: 'prefers-short', type: 'feedback', summary: 'likes terse answers', sources: [] })
    expect(a.body).toBe('Keep it short.\n')
    const b = readMemory(join(root, 'projects', 'C--code-app', 'topics', 'plain.md'))!
    expect(b.meta).toMatchObject({ name: 'plain', type: 'project', summary: 'Release on Fridays.' })
    expect(existsSync(join(root, 'projects', 'C--code-app', 'topics', 'MEMORY.md'))).toBe(false)
    expect(existsSync(join(root, 'projects', 'SKIP'))).toBe(false)
    expect(importAutoMemory(root, cp, 'SKIP')).toBe(0)
  })
  it('does nothing when ~/.claude/projects is missing', () =>
    expect(importAutoMemory(mkdtempSync(join(tmpdir(), 'ccm-mem-')), 'C:\\no\\such', 'x')).toBe(0))
})
```

- [ ] **Step 2: Run the tests to confirm they fail.**
  Run: `npx vitest run test/memory-import.test.ts`
  Expected: FAIL, module not found.

- [ ] **Step 3: Implement.** Create `src/main/memory/import.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests and typecheck.**
  Run: `npx vitest run test/memory-import.test.ts && npm run typecheck`
  Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/main/memory/import.ts test/memory-import.test.ts
git commit -m "feat(memory): import Claude Code auto-memory on first run"
```

---

### Task 9: Hook script

**Files:**
- Create: `resources/memory-hook.mjs`
- Test: `test/memory-hook.test.ts`

**Interfaces:**
- Produces the command-line contract `node memory-hook.mjs start|enqueue`, which reads Claude Code hook JSON on stdin.
  - **`start`:** prints the context text and writes the byte count to `<root>/.injected`.
  - **`enqueue`:** appends `{"kind":"distill","transcript":…}` to `<root>/.queue`, the line format Task 5's `readQueue` accepts.

- [ ] **Step 1: Write the failing tests.** Create `test/memory-hook.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const hook = resolve('resources/memory-hook.mjs')
const run = (event: string, input: string, env: Record<string, string>) =>
  spawnSync('node', [hook, event], { input, encoding: 'utf8', env: { ...process.env, ...env } })

function memory() {
  const root = mkdtempSync(join(tmpdir(), 'ccm-hook-'))
  writeFileSync(join(root, 'INDEX.md'), '- [g](topics/g.md) — global fact\n')
  mkdirSync(join(root, 'projects', 'C--code-app'), { recursive: true })
  writeFileSync(join(root, 'projects', 'C--code-app', 'INDEX.md'), '- [p](projects/C--code-app/topics/p.md) — project fact\n')
  return root
}

describe('memory-hook start', () => {
  it('prints both indexes for the project and records the injected size', () => {
    const root = memory()
    const r = run('start', JSON.stringify({ cwd: 'C:\\code\\app' }), { CCM_MEMORY_DIR: root })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain(`Memory lives in ${root}`)
    expect(r.stdout).toContain('global fact')
    expect(r.stdout).toContain('project fact')
    expect(Number(readFileSync(join(root, '.injected'), 'utf8'))).toBe(Buffer.byteLength(r.stdout.trimEnd()))
  })
  it('prints nothing when there is no memory', () => {
    const r = run('start', JSON.stringify({ cwd: 'C:\\x' }), { CCM_MEMORY_DIR: join(tmpdir(), 'ccm-none-xyz') })
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')
  })
  it('exits 0 silently on garbage input', () => {
    const r = run('start', '{not json', { CCM_MEMORY_DIR: memory() })
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')
  })
  it('does nothing inside the distiller', () => {
    const root = memory()
    const r = run('start', JSON.stringify({ cwd: 'C:\\code\\app' }), { CCM_MEMORY_DIR: root, CCM_DISTILLER: '1' })
    expect(r.stdout).toBe('')
    run('enqueue', JSON.stringify({ transcript_path: 'C:\\t.jsonl' }), { CCM_MEMORY_DIR: root, CCM_DISTILLER: '1' })
    expect(existsSync(join(root, '.queue'))).toBe(false)
  })
})

describe('memory-hook enqueue', () => {
  it('appends a distill job', () => {
    const root = memory()
    run('enqueue', JSON.stringify({ transcript_path: 'C:\\t\\a.jsonl' }), { CCM_MEMORY_DIR: root })
    run('enqueue', JSON.stringify({ transcript_path: 'C:\\t\\b.jsonl' }), { CCM_MEMORY_DIR: root })
    expect(readFileSync(join(root, '.queue'), 'utf8')).toBe(
      '{"kind":"distill","transcript":"C:\\\\t\\\\a.jsonl"}\n{"kind":"distill","transcript":"C:\\\\t\\\\b.jsonl"}\n'
    )
  })
})
```

- [ ] **Step 2: Run the tests to confirm they fail.**
  Run: `npx vitest run test/memory-hook.test.ts`
  Expected: FAIL. `node` can't find the script, so it exits non-zero.

- [ ] **Step 3: Implement.** Create `resources/memory-hook.mjs`:

```js
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
```

- [ ] **Step 4: Run the tests.**
  Run: `npx vitest run test/memory-hook.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add resources/memory-hook.mjs test/memory-hook.test.ts
git commit -m "feat(memory): session hook that injects indexes and queues transcripts"
```

---

### Task 10: Prompts and the runner

**Files:**
- Create: `src/main/memory/prompts.ts`
- Create: `src/main/memory/runner.ts`
- Create: `test/fixtures/fake-distiller.mjs`
- Test: `test/memory-prompts.test.ts`, `test/memory-runner.test.ts`

**Interfaces:**
- Consumes everything from Tasks 1–8.
- Produces:
  - **Prompts:**
    - `distillPrompt(o: { slice: string; globalIndex: string; projectIndex: string; projectDir: string; day: string }): string`
    - `recheckPrompt(m: Memory, sources: { file: string; text: string | null }[]): string`
    - `parseVerdict(out: string): { verdict: 'KEEP' | 'DELETE' | 'REWRITE'; body: string } | null`
  - **Runner:**
    - `interface RunnerOptions { root: string; claudeProjects: string; command: string; model: string; dailyCap: number; indexCap: number; run?: Runner; today?: () => string }`
    - `class MemoryRunner { log: string[]; init(): Promise<boolean>; drain(): Promise<void>; stop(): void }`

- [ ] **Step 1: Write the failing prompt tests.** Create `test/memory-prompts.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { distillPrompt, parseVerdict, recheckPrompt } from '../src/main/memory/prompts'

describe('prompts', () => {
  it('distill prompt names the project folder, the day and the excerpt', () => {
    const p = distillPrompt({ slice: 'USER: hi', globalIndex: '', projectIndex: '- [a](x) — y', projectDir: 'projects/C--app', day: '2026-09-24' })
    expect(p).toContain('projects/C--app/topics/<name>.md')
    expect(p).toContain('verified: 2026-09-24')
    expect(p).toContain('(empty)')
    expect(p).toContain('- [a](x) — y')
    expect(p.trimEnd().endsWith('USER: hi')).toBe(true)
  })
  it('recheck prompt starts with RECHECK and marks deleted files', () => {
    const m = { file: 'x', body: 'fact', meta: { name: 'a', type: 'project' as const, summary: 's', sources: [], verified: 'd', used: 'd', uses: 0, stale: true, pinned: false } }
    const p = recheckPrompt(m, [{ file: 'a.ts', text: 'code' }, { file: 'b.ts', text: null }])
    expect(p.startsWith('RECHECK')).toBe(true)
    expect(p).toContain('<<<a.ts>>>\ncode')
    expect(p).toContain('<<<b.ts>>>\n(deleted)')
  })
  it('parses verdicts', () => {
    expect(parseVerdict('KEEP')).toEqual({ verdict: 'KEEP', body: '' })
    expect(parseVerdict('noise\nREWRITE\nNew text.\n')).toEqual({ verdict: 'REWRITE', body: 'New text.\n' })
    expect(parseVerdict('DELETE — obsolete')?.verdict).toBe('DELETE')
    expect(parseVerdict('I am not sure')).toBeNull()
  })
})
```

- [ ] **Step 2: Implement the prompts.** Create `src/main/memory/prompts.ts`:

```ts
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
```

  Run: `npx vitest run test/memory-prompts.test.ts`
  Expected: PASS.

- [ ] **Step 3: Create the fake distiller.** Create `test/fixtures/fake-distiller.mjs`:

```js
// Stand-in for `claude -p` in memory runner tests; behaviour is picked with CCM_FAKE_* env vars.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const prompt = readFileSync(0, 'utf8')
const recheck = prompt.startsWith('RECHECK')
if (process.env.CCM_FAKE_LOG) appendFileSync(process.env.CCM_FAKE_LOG, recheck ? 'recheck\n' : 'distill\n')
if (process.env.CCM_FAKE_FAIL) {
  writeFileSync('topics/half-written.md', 'partial') // must be rolled back
  process.exit(1)
}
if (recheck) {
  console.log(process.env.CCM_FAKE_VERDICT ?? 'KEEP')
  process.exit(0)
}
const dir = /(projects\/[^/\s]+)\/topics\//.exec(prompt)[1]
mkdirSync(`${dir}/topics`, { recursive: true })
const secret = process.env.CCM_FAKE_SECRET ? `token ghp_${'a'.repeat(36)}\n` : ''
writeFileSync(
  `${dir}/topics/fake-fact.md`,
  `---\nname: fake-fact\ntype: project\nsummary: a fact the fake distiller learned\nsources: [app.ts]\nverified: 2026-09-24\nused: 2026-09-24\nuses: 0\nstale: false\npinned: false\n---\nThe fake distiller ran.\n${secret}`
)
console.log('added fake-fact')
```

- [ ] **Step 4: Write the failing runner tests.** Create `test/memory-runner.test.ts`:

```ts
import { afterEach, describe, it, expect } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { readMemory, slugFor, writeMemory, writeProject } from '../src/main/memory/files'
import { MemoryRunner } from '../src/main/memory/runner'
import { enqueue, git, readQueue, readState } from '../src/main/memory/store'

const DAY = '2026-09-24'
const fake = `node "${resolve('test/fixtures/fake-distiller.mjs')}"`
const runners: MemoryRunner[] = []
afterEach(() => {
  for (const r of runners.splice(0)) r.stop()
  for (const k of ['CCM_FAKE_LOG', 'CCM_FAKE_FAIL', 'CCM_FAKE_SECRET', 'CCM_FAKE_VERDICT']) delete process.env[k]
})

function world() {
  const base = mkdtempSync(join(tmpdir(), 'ccm-run-'))
  const project = join(base, 'app')
  const cp = join(base, 'claude-projects')
  mkdirSync(project)
  mkdirSync(join(cp, slugFor(project)), { recursive: true })
  const log = join(base, 'calls.log')
  process.env.CCM_FAKE_LOG = log
  const transcript = join(cp, slugFor(project), 's1.jsonl')
  const say = (text: string) =>
    writeFileSync(transcript, `${JSON.stringify({ type: 'user', cwd: project, message: { role: 'user', content: text } })}\n`, { flag: 'a' })
  const make = (over: { dailyCap?: number } = {}) => {
    const r = new MemoryRunner({ root: join(base, 'memory'), claudeProjects: cp, command: fake, model: 'haiku', dailyCap: 30, indexCap: 60, today: () => DAY, ...over })
    runners.push(r)
    return r
  }
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [])
  return { base, root: join(base, 'memory'), project, transcript, say, make, calls }
}

describe('MemoryRunner', () => {
  it('first launch imports auto-memory and does not queue old transcripts', async () => {
    const w = world()
    w.say('x'.repeat(9000))
    const r = w.make()
    expect(await r.init()).toBe(true)
    expect(w.calls()).toEqual([])
    expect(readQueue(w.root)).toEqual([])
    expect(readState(w.root).imported).toBe(true)
  })

  it('distills a queued transcript into a committed, indexed memory', async () => {
    const w = world()
    const r = w.make()
    await r.init()
    w.say('x'.repeat(9000))
    enqueue(w.root, { kind: 'distill', transcript: w.transcript })
    await r.drain()
    const slug = slugFor(w.project)
    const fact = readMemory(join(w.root, 'projects', slug, 'topics', 'fake-fact.md'))!
    expect(fact.meta.sources).toEqual(['app.ts']) // not a git repo: left unstamped
    expect(readFileSync(join(w.root, 'projects', slug, 'INDEX.md'), 'utf8')).toContain('fake-fact')
    expect(JSON.parse(readFileSync(join(w.root, 'projects', slug, 'project.json'), 'utf8')).path).toBe(w.project)
    expect((await git(w.root, 'status', '--porcelain')).trim()).toBe('')
    expect(readQueue(w.root)).toEqual([])
    expect(readState(w.root).runs).toEqual({ day: DAY, count: 1 })
  })

  it('skips slices too small to be worth a model call but still advances', async () => {
    const w = world()
    const r = w.make()
    await r.init()
    w.say('short')
    enqueue(w.root, { kind: 'distill', transcript: w.transcript })
    await r.drain()
    expect(w.calls()).toEqual([])
    expect(readQueue(w.root)).toEqual([])
    expect(Object.values(readState(w.root).offsets)[0]).toBeGreaterThan(0)
  })

  it('rolls back output that fails validation, keeping hand edits', async () => {
    const w = world()
    const r = w.make()
    await r.init()
    const mine = join(w.root, 'topics', 'mine.md')
    writeMemory({ file: mine, body: 'hand edit\n', meta: { name: 'mine', type: 'reference', summary: 'mine', sources: [], verified: DAY, used: DAY, uses: 0, stale: false, pinned: false } })
    process.env.CCM_FAKE_SECRET = '1'
    w.say('x'.repeat(9000))
    enqueue(w.root, { kind: 'distill', transcript: w.transcript })
    await r.drain()
    expect(existsSync(join(w.root, 'projects', slugFor(w.project), 'topics', 'fake-fact.md'))).toBe(false)
    expect(readMemory(mine)!.body).toBe('hand edit\n')
    expect(readQueue(w.root)).toEqual([])
    expect(r.log.some(l => l.includes('secret'))).toBe(true)
  })

  it('keeps the job and stops when the distiller fails', async () => {
    const w = world()
    const r = w.make()
    await r.init()
    process.env.CCM_FAKE_FAIL = '1'
    w.say('x'.repeat(9000))
    enqueue(w.root, { kind: 'distill', transcript: w.transcript })
    await r.drain()
    expect(readQueue(w.root)).toHaveLength(1)
    expect(existsSync(join(w.root, 'topics', 'half-written.md'))).toBe(false)
    delete process.env.CCM_FAKE_FAIL
    await r.drain() // halted until next start
    expect(w.calls()).toEqual(['distill'])
  })

  it('leaves jobs queued once the daily cap is reached', async () => {
    const w = world()
    const r = w.make({ dailyCap: 0 })
    await r.init()
    w.say('x'.repeat(9000))
    enqueue(w.root, { kind: 'distill', transcript: w.transcript })
    await r.drain()
    expect(w.calls()).toEqual([])
    expect(readQueue(w.root)).toHaveLength(1)
  })

  it('catches up on transcripts that grew while the app was closed', async () => {
    const w = world()
    await w.make().init()
    w.say('x'.repeat(9000))
    const again = w.make()
    await again.init()
    expect(w.calls()).toEqual(['distill'])
  })

  it('re-checks a memory whose source changed', async () => {
    const w = world()
    const r = w.make()
    await r.init()
    const gitc = (...a: string[]) => git(w.project, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a)
    await git(w.project, 'init', '-q')
    writeFileSync(join(w.project, 'app.ts'), 'v1')
    await gitc('add', '-A')
    await gitc('commit', '-qm', 'v1')
    const hash = (await git(w.project, 'log', '-1', '--format=%h')).trim()
    const slug = slugFor(w.project)
    writeProject(w.root, slug, w.project)
    const f = join(w.root, 'projects', slug, 'topics', 'a.md')
    writeMemory({ file: f, body: 'fact\n', meta: { name: 'a', type: 'project', summary: 'a', sources: [`app.ts@${hash}`], verified: '2026-09-01', used: DAY, uses: 0, stale: false, pinned: false } })
    writeFileSync(join(w.project, 'app.ts'), 'v2')
    await gitc('commit', '-qam', 'v2')

    await r.drain() // maintenance marks it stale and queues a re-check
    expect(readMemory(f)!.meta.stale).toBe(true)
    await r.drain() // runs the re-check: KEEP
    const m = readMemory(f)!.meta
    expect(m.stale).toBe(false)
    expect(m.verified).toBe(DAY)
    expect(m.sources[0]).not.toBe(`app.ts@${hash}`)
    expect(w.calls()).toEqual(['recheck'])
  })
})
```

- [ ] **Step 5: Run the tests to confirm they fail.**
  Run: `npx vitest run test/memory-runner.test.ts`
  Expected: FAIL, "Cannot find module '../src/main/memory/runner'".

- [ ] **Step 6: Implement the runner.** Create `src/main/memory/runner.ts`:

```ts
import { existsSync, readFileSync, readdirSync, rmSync, statSync, unwatchFile, watchFile } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { runShell, type Runner } from '../run'
import { projectPath, readMemory, slugFor, today, writeMemory, writeProject } from './files'
import { importAutoMemory } from './import'
import { rebuildIndexes } from './indexes'
import { archive, checkSources, promote, recordUse, refreshSources, splitSource, stampSources } from './maintain'
import { distillPrompt, parseVerdict, recheckPrompt } from './prompts'
import { commit, enqueue, ensureRepo, pathKey, readQueue, readState, removeJob, writeState } from './store'
import { sliceTranscript } from './transcript'
import { SECRET, changedFiles, problems, rollback } from './validate'

export interface RunnerOptions {
  root: string
  claudeProjects: string
  command: string
  model: string
  dailyCap: number
  indexCap: number
  run?: Runner
  today?: () => string
}

const MIN_CHARS = 8_000 // ~2k tokens: less isn't worth a model call
const TIMEOUT_MS = 5 * 60_000
const msg = (err: unknown) => (err instanceof Error ? err.message : String(err))

export class MemoryRunner {
  log: string[] = []
  private busy = false
  private halted = false
  private readonly run: Runner
  private readonly day: () => string

  constructor(private readonly o: RunnerOptions) {
    this.run = o.run ?? runShell
    this.day = o.today ?? today
  }

  private say(line: string): void {
    this.log = [...this.log, line].slice(-50)
  }

  private env(): NodeJS.ProcessEnv {
    return { ...process.env, CCM_DISTILLER: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' }
  }

  async init(): Promise<boolean> {
    const { root } = this.o
    try {
      await ensureRepo(root)
    } catch (err) {
      this.say(`Memory is off: ${msg(err)}`)
      this.halted = true
      return false
    }
    const s = readState(root)
    if (!s.imported) {
      const n = importAutoMemory(root, this.o.claudeProjects, slugFor(root))
      // History before the first launch arrives through the import, not by re-distilling every transcript.
      for (const f of this.transcripts()) s.offsets[pathKey(f)] = statSync(f).size
      s.imported = true
      writeState(root, s)
      this.say(`Imported ${n} auto-memory files.`)
    } else {
      for (const f of this.transcripts())
        if (statSync(f).size > (s.offsets[pathKey(f)] ?? 0)) enqueue(root, { kind: 'distill', transcript: f })
    }
    watchFile(join(root, '.queue'), { interval: 2000 }, () => void this.drain())
    await this.drain()
    return true
  }

  stop(): void {
    this.halted = true
    unwatchFile(join(this.o.root, '.queue'))
  }

  private transcripts(): string[] {
    const cp = this.o.claudeProjects
    const skip = slugFor(this.o.root) // the distiller's own sessions
    if (!existsSync(cp)) return []
    return readdirSync(cp, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name !== skip)
      .flatMap(d => readdirSync(join(cp, d.name)).filter(f => f.endsWith('.jsonl')).map(f => join(cp, d.name, f)))
  }

  async drain(): Promise<void> {
    if (this.busy || this.halted) return
    this.busy = true
    const { root } = this.o
    try {
      for (let job = readQueue(root)[0]; job && !this.halted; job = readQueue(root)[0]) {
        const s = readState(root)
        if (s.runs.day !== this.day()) s.runs = { day: this.day(), count: 0 }
        writeState(root, s)
        if (s.runs.count >= this.o.dailyCap) {
          this.say(`Daily cap of ${this.o.dailyCap} runs reached; ${readQueue(root).length} jobs wait for tomorrow.`)
          break
        }
        const ok = job.kind === 'distill' ? await this.distill(job.transcript) : await this.recheck(job.file)
        if (!ok) {
          this.halted = true // retried at next app start
          break
        }
        removeJob(root, job)
      }
      await this.maintain()
    } catch (err) {
      this.say(`Memory job failed: ${msg(err)}`)
      this.halted = true
    } finally {
      this.busy = false
    }
  }

  private countRun(): void {
    const s = readState(this.o.root)
    s.runs.count += 1
    writeState(this.o.root, s)
  }

  private command(tools: boolean): string {
    const { command, model } = this.o
    return `${command} -p --model ${model} --strict-mcp-config${tools ? ' --allowedTools Read,Write,Edit,Glob,Grep --permission-mode acceptEdits' : ''}`
  }

  private async distill(transcript: string): Promise<boolean> {
    const { root } = this.o
    if (!existsSync(transcript)) return true
    const key = pathKey(transcript)
    const slice = sliceTranscript(transcript, readState(root).offsets[key] ?? 0)
    const day = this.day()
    const worth = slice.text.length >= MIN_CHARS && !!slice.cwd
    recordUse(root, slice.reads, day)
    if (worth) writeProject(root, slugFor(slice.cwd!), slice.cwd!)
    // Commits hand edits too, so a rollback below only ever undoes the distiller.
    await commit(root, 'Record memory use')
    if (worth) {
      const slug = slugFor(slice.cwd!)
      const read = (f: string) => (existsSync(f) ? readFileSync(f, 'utf8') : '')
      const input = distillPrompt({
        slice: slice.text,
        globalIndex: read(join(root, 'INDEX.md')),
        projectIndex: read(join(root, 'projects', slug, 'INDEX.md')),
        projectDir: `projects/${slug}`,
        day
      })
      const r = await this.run(this.command(true), l => this.say(l), { cwd: root, env: this.env(), input, timeoutMs: TIMEOUT_MS })
      this.countRun()
      if (r.code !== 0) {
        await rollback(root)
        this.say(`Distiller exited with code ${r.code}; will retry at next start.`)
        return false
      }
      const bad = problems(root, await changedFiles(root))
      if (bad.length) {
        await rollback(root)
        this.say(`Discarded distiller changes: ${bad.join('; ')}`)
      } else {
        await stampSources(root, slug, slice.cwd!)
        promote(root)
        rebuildIndexes(root, this.o.indexCap, day)
        await commit(root, `Distill ${basename(transcript, '.jsonl')}`)
      }
    }
    const s = readState(root)
    s.offsets[key] = slice.end
    writeState(root, s)
    return true
  }

  private async recheck(file: string): Promise<boolean> {
    const { root } = this.o
    const m = readMemory(file)
    const dir = projectPath(root, basename(dirname(dirname(file)))) // projects/<slug>/topics/<name>.md
    if (!m || !dir) return true
    const sources = m.meta.sources.map(s => {
      const f = join(dir, splitSource(s)[0])
      return { file: splitSource(s)[0], text: existsSync(f) ? readFileSync(f, 'utf8').slice(0, 20_000) : null }
    })
    const r = await this.run(this.command(false), l => this.say(l), { cwd: root, env: this.env(), input: recheckPrompt(m, sources), timeoutMs: TIMEOUT_MS })
    this.countRun()
    if (r.code !== 0) {
      this.say(`Re-check exited with code ${r.code}; will retry at next start.`)
      return false
    }
    const v = parseVerdict(r.output)
    if (!v || (v.verdict === 'REWRITE' && !v.body.trim()) || SECRET.test(v.body)) {
      this.say(`Re-check of ${m.meta.name} gave no usable answer; it stays marked stale.`)
      return true
    }
    const day = this.day()
    if (v.verdict === 'DELETE') rmSync(file)
    else
      writeMemory({
        ...m,
        body: v.verdict === 'REWRITE' ? v.body : m.body,
        meta: { ...m.meta, verified: day, stale: false, sources: await refreshSources(dir, m.meta.sources) }
      })
    rebuildIndexes(root, this.o.indexCap, day)
    await commit(root, `Re-check ${m.meta.name}`)
    return true
  }

  private async maintain(): Promise<void> {
    const { root } = this.o
    const day = this.day()
    for (const file of await checkSources(root)) enqueue(root, { kind: 'recheck', file })
    archive(root, day)
    promote(root)
    rebuildIndexes(root, this.o.indexCap, day)
    await commit(root, 'Maintain memory')
  }
}
```

- [ ] **Step 7: Run the tests and typecheck.**
  Run: `npx vitest run test/memory-prompts.test.ts test/memory-runner.test.ts && npm run typecheck`
  Expected: PASS.
  - **If the re-check test fails** because the first `drain()` already ran the re-check (the queue is read again after `maintain`), that's still correct behaviour. Collapse the two `drain()` calls into one and keep the assertions after it.
  - **If the fake distiller's writes leak into the next test,** check that every test calls `w.make()` on a fresh `world()`.

- [ ] **Step 8: Commit.**

```bash
git add src/main/memory/prompts.ts src/main/memory/runner.ts test/fixtures/fake-distiller.mjs test/memory-prompts.test.ts test/memory-runner.test.ts
git commit -m "feat(memory): runner that distills sessions, re-checks stale memories and maintains the tree"
```

---

### Task 11: Memory settings

**Files:**
- Modify: `src/main/settings.ts`
- Test: `test/settings.test.ts`

**Interfaces:**
- Produces:
  - `interface MemorySettings { model: string; dailyCap: number; indexCap: number }`
  - `Settings.memory: MemorySettings`
  - defaults `{ model: 'claude-haiku-4-5-20251001', dailyCap: 30, indexCap: 60 }`

- [ ] **Step 1: Write the failing tests.** Append to `test/settings.test.ts`:

```ts
describe('memory settings', () => {
  it('defaults when missing', () =>
    expect(loadSettings(join(dir, 'none.json')).memory).toEqual({ model: 'claude-haiku-4-5-20251001', dailyCap: 30, indexCap: 60 }))
  it('keeps valid values and fills the rest', () => {
    const f = join(dir, 'mem-partial.json')
    writeFileSync(f, JSON.stringify({ memory: { dailyCap: 5 } }))
    expect(loadSettings(f).memory).toEqual({ model: 'claude-haiku-4-5-20251001', dailyCap: 5, indexCap: 60 })
  })
  it('repairs wrong types, out-of-range caps and unsafe model names', () => {
    const f = join(dir, 'mem-bad.json')
    writeFileSync(f, JSON.stringify({ memory: { model: 'haiku & del /q *', dailyCap: -1, indexCap: 2.5 } }))
    expect(loadSettings(f).memory).toEqual(defaults().memory)
    writeFileSync(f, JSON.stringify({ memory: 'nope' }))
    expect(loadSettings(f).memory).toEqual(defaults().memory)
  })
})
```

- [ ] **Step 2: Run the tests to confirm they fail.**
  Run: `npx vitest run test/settings.test.ts`
  Expected: the new tests FAIL, because `memory` is undefined.

- [ ] **Step 3: Implement.** In `src/main/settings.ts`:
  - Add the interface and field:

```ts
export interface MemorySettings {
  model: string
  dailyCap: number
  indexCap: number
}
```

  - Add `memory: MemorySettings` to `Settings`.
  - Replace `defaults` with:

```ts
export const defaults = (): Settings => ({
  recent: [],
  headroom: true,
  ponytail: true,
  skipped: [],
  split: 0.6,
  tab: 'cost',
  memory: { model: 'claude-haiku-4-5-20251001', dailyCap: 30, indexCap: 60 }
})
```

  - In `loadSettings`, directly before `return s`, add:

```ts
  const m: Partial<MemorySettings> = s.memory && typeof s.memory === 'object' && !Array.isArray(s.memory) ? s.memory : {}
  const d = defaults().memory
  const int = (v: unknown, lo: number, hi: number, dflt: number) =>
    Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi ? (v as number) : dflt
  s.memory = {
    // The model name goes into a shell command line, so only plain model ids are allowed.
    model: typeof m.model === 'string' && /^[\w.:-]+$/.test(m.model) ? m.model : d.model,
    dailyCap: int(m.dailyCap, 0, 1000, d.dailyCap),
    indexCap: int(m.indexCap, 10, 200, d.indexCap)
  }
```

- [ ] **Step 4: Run the tests and typecheck.**
  Run: `npx vitest run test/settings.test.ts && npm run typecheck`
  Expected: all PASS. This includes the older `toEqual(defaults())` tests, which now include `memory`.

- [ ] **Step 5: Commit.**

```bash
git add src/main/settings.ts test/settings.test.ts
git commit -m "feat(settings): memory model, daily cap and index cap"
```

---

### Task 12: Wire it into the app

**Files:**
- Modify: `src/main/index.ts` (imports; `launchClaude` at L76–104; `startDashboard` at L140–163; `service:log` at L231; `before-quit` at L365–370)
- Modify: `electron-builder.yml`
- Modify: `test/fixtures/fake-claude.mjs`
- Modify: `test/smoke.spec.ts`

**Interfaces:**
- Consumes:
  - from Task 10: `MemoryRunner`;
  - from Task 2: `memDir()` and `claudeProjectsDir()`;
  - from Task 11: `settings.memory`.
- Graph check: `startDashboard()` is called from three places (`index.ts:191`, `:196`, `:258`) but returns early on its `started` flag, so exactly one `MemoryRunner` is created.

- [ ] **Step 1: Extend the smoke test first.** In `test/smoke.spec.ts`:
  - Add a `memory` temp dir.
  - Add the new env seams.
  - Assert the launch args, the env var, and that the runner initialised the repo.

  Replace the `env` block and add assertions after the `ANTHROPIC_BASE_URL` expectation:

```ts
  const memory = join(mkdtempSync(join(tmpdir(), 'ccm-mem-')), 'memory')
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      CCM_SKIP_SETUP: '1',
      CCM_USER_DATA: mkdtempSync(join(tmpdir(), 'ccm-data-')),
      CCM_PROJECT: project,
      CCM_TEST_PIDS: pids,
      CCM_CMD_CLAUDE: join(fixtures, 'fake-claude.cmd'),
      CCM_CMD_CODEBURN: stub,
      CCM_CMD_HEADROOM: stub,
      CCM_MEMORY_DIR: memory,
      CCM_CLAUDE_PROJECTS: mkdtempSync(join(tmpdir(), 'ccm-cp-')),
      CCM_CMD_DISTILLER: `node "${join(fixtures, 'fake-distiller.mjs')}"`
    }
  })
```

```ts
  await expect(term).toContainText('ARGS=--settings')
  await expect(term).toContainText('AUTO_MEMORY_OFF=1')
  await expect.poll(() => existsSync(join(memory, '.git')), { timeout: 15_000 }).toBe(true)
```

  Add `existsSync` to the `node:fs` import.

  In `test/fixtures/fake-claude.mjs`, after the `ANTHROPIC_BASE_URL` line, add:

```js
console.log(`ARGS=${process.argv.slice(2).join(' ')}`)
console.log(`AUTO_MEMORY_OFF=${process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY ?? '0'}`)
```

- [ ] **Step 2: Run the smoke test to confirm it fails.**
  Run: `npm run smoke`
  Expected: FAIL on `ARGS=--settings`, since there are no args yet.

- [ ] **Step 3: Implement the wiring** in `src/main/index.ts`.

  **Imports:** change the `node:fs` import to include `writeFileSync`, and add:

```ts
import { MemoryRunner } from './memory/runner'
import { claudeProjectsDir, memDir } from './memory/files'
```

  **Module state:** next to `let services …`, add:

```ts
let memory: MemoryRunner | null = null
```

  **Hook settings:** below `const graphFile = …`, add:

```ts
const hookScript = () =>
  (app.isPackaged ? join(process.resourcesPath, 'memory-hook.mjs') : join(app.getAppPath(), 'resources', 'memory-hook.mjs')).replace(/\\/g, '/')

// Memory hooks for app-launched sessions only: passed with --settings, so ~/.claude/settings.json is never touched.
function writeHooks(): string {
  const hook = (event: string) => [{ hooks: [{ type: 'command', command: `node "${hookScript()}" ${event}` }] }]
  const file = join(app.getPath('userData'), 'ccm-hooks.json')
  writeFileSync(file, JSON.stringify({ hooks: { SessionStart: hook('start'), SessionEnd: hook('enqueue'), PreCompact: hook('enqueue') } }, null, 2))
  return file
}
```

  **Launch:** in `launchClaude()`, after the Headroom env line, add:

```ts
  env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1'
  env.CCM_MEMORY_DIR = memDir()
```

  and replace the `spawnPty(...)` first two arguments with:

```ts
    // A string is passed to cmd.exe verbatim; /s keeps the inner quotes intact when paths contain spaces.
    const p = spawnPty(process.env.ComSpec ?? 'cmd.exe', `/s /c ""${override('CLAUDE', 'claude')}" --settings "${writeHooks()}""`, {
```

  **Runner start:** in `startDashboard()`, after `syncServices()`, add:

```ts
  memory = new MemoryRunner({ root: memDir(), claudeProjects: claudeProjectsDir(), command: override('DISTILLER', 'claude'), ...settings.memory })
  void memory.init()
```

  **Logs:** replace the `service:log` handler with:

```ts
  ipcMain.handle('service:log', (_e, n: unknown) => (n === 'memory' ? (memory?.log ?? []) : (svc(n)?.log ?? [])))
```

  **Quit:** in `before-quit`, before `killAll()`, add:

```ts
    memory?.stop()
```

  `killAll()` already kills a running distiller, because it's spawned through `runShell`.

  **Packaging:** in `electron-builder.yml`, after `asarUnpack`, add:

```yaml
extraResources:
  - from: resources/memory-hook.mjs
    to: memory-hook.mjs
```

- [ ] **Step 4: Run everything.**
  Run: `npm run typecheck && npm test && npm run smoke`
  Expected: all PASS. The smoke terminal shows `ARGS=--settings C:/…/ccm-hooks.json` and `AUTO_MEMORY_OFF=1`, the memory repo exists, and no orphans are left.

- [ ] **Step 5: Confirm the hook ships in the package.**
  Run: `npm run dist`
  Expected: `dist/win-unpacked/resources/memory-hook.mjs` exists.

- [ ] **Step 6: Commit.**

```bash
git add src/main/index.ts electron-builder.yml test/fixtures/fake-claude.mjs test/smoke.spec.ts
git commit -m "feat(memory): launch Claude with memory hooks and run the distiller in the background"
```

---

### Task 13: Manual verification with the real Claude Code

No code changes. Every result gets reported, including failures.

- [ ] **Step 1:** Run `npm run dev` and open a project that has git history.
- [ ] **Step 2:** In the embedded terminal, run `/hooks`.
  Expected: the three `memory-hook.mjs` hooks are listed **alongside** any hooks from the user's own settings. That confirms `--settings` merges rather than replaces (spec §11).
- [ ] **Step 3:** Have a short working conversation, then `/exit`.
  Within a minute, `~/.claudecodemax/memory/.queue` empties and `git -C ~/.claudecodemax/memory log --oneline` shows a `Distill …` commit, or no commit if Haiku found nothing worth keeping. Memory's log is retrievable with `window.api.serviceLog('memory')` from DevTools.
- [ ] **Step 4:** Relaunch Claude with **Restart** and ask *"What does your memory index say?"*
  Expected: Claude quotes the injected lines. Check that `~/.claudecodemax/memory/.injected` is under ~6,000 bytes (≈1.5k tokens).
- [ ] **Step 5:** Check Codeburn's Cost tab.
  Expected: the distiller session shows up on the Haiku model.
- [ ] **Step 6:** Confirm Claude Code started from a normal terminal (outside the app) still uses its built-in auto memory, and has no ClaudeCodeMax hooks in `/hooks`.
