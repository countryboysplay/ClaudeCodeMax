# Persistent Memory — Design Spec

Date: 2026-09-24
Status: Approved in brainstorming, pending written-spec review

## 1. Goal

Claude forgets everything between sessions. Claude Code's built-in auto memory helps, but it is per project, it only grows, and it loads up to 200 lines / 25KB every session whether or not any of it is still true.

ClaudeCodeMax gets its own memory: a plain-markdown file tree, written automatically by a cheap background model, shared across all projects, that loads a small capped index per session and lets Claude read the rest on demand.

**Primary aim:** less stale context and fewer tokens per session.

**Success criteria**
- A fact learned in one session is available in the next session without the user repeating it.
- Session-start memory load stays under the index cap (default ~1.5k tokens for global + project together).
- A memory whose source file changed is flagged and re-checked, not silently trusted.
- The user can see, pin, archive and roll back every memory, and move the whole memory to another PC.
- Claude Code run outside the app is unaffected.

**Non-goals**
- Vector or semantic search. Grep over markdown is enough at the expected size (hundreds of files).
- Editing `CLAUDE.md` files. Memory never writes to them.
- A "tokens saved" number. There's no honest counterfactual; Headroom already measures real compression savings.
- Adopting claude-mem. Evaluated 2026-09-24 and rejected: open Windows issues (≈3.5s per-tool-call hook overhead, Chroma install loops), no token cap on its session-start injection, hosted-service defaults, plus a Bun worker, Chroma and a port to supervise.

**Inspiration:** the layering follows ICM (Interpretable Context Methodology, RinDig/Interpretable-Context-Methodology, MIT). A small always-loaded layer routes to detail files that are read only when relevant. ICM itself has no memory or learning; this design adds that.

## 2. File tree and format

**Location:** `~/.claudecodemax/memory/`, overridable with `CCM_MEMORY_DIR` (used by tests, like the other `CCM_*` seams). It lives outside `userData` so it's easy to find, back up and sync.

```
memory/
  .git/                     the memory folder is its own git repo
  .gitignore                .state.json, .queue
  .state.json               machine-local: transcript offsets, last injected size, daily run count
  .queue                    machine-local: pending distiller jobs, one JSON line each
  .rejected                 names of rejected skill proposals
  .claude-plugin/plugin.json  makes the folder a plugin so approved skills load (§6)
  INDEX.md                  global index (generated)
  user.md                   the user model (type: user)
  topics/<name>.md          global memories
  archive/<name>.md         decayed memories, kept out of every index
  skills/<name>/SKILL.md    approved learned skills
  inbox/<name>/SKILL.md     proposed skills awaiting approval
  projects/<slug>/
    project.json            { "remote": "...", "path": "..." }
    INDEX.md                project index (generated)
    topics/<name>.md
```

`<slug>` is the same path-derived folder name Claude Code uses under `~/.claude/projects/`, so a project's memory lines up with its transcripts without a lookup table.

**Memory file** — one fact per file:

```markdown
---
name: release-flow
type: project            # user | feedback | project | reference
summary: tag v* → draft release → electron-builder publishes
sources: [.github/workflows/release.yml@06dc326]
verified: 2026-09-24
used: 2026-09-24
uses: 3
stale: false
pinned: false
---
Tags v* trigger release.yml. It creates the draft first so electron-builder's
parallel uploads don't split into duplicate drafts.
**Why:** duplicate drafts happened on v0.1.1.
```

- `sources`: files the fact came from, as repo-relative path `@` short commit hash. May be empty.
- `verified`: last date the fact was confirmed against its sources or a session.
- `used` / `uses`: last date and count of Claude reading the file.
- Topic files are capped at 200 lines.

**Indexes are generated in code**, never written by the model. After every job the runner rebuilds each `INDEX.md` from frontmatter: one line per memory, `- [name](topics/name.md) — summary`, suffixed ` (may be stale)` when `stale: true`.

**Index cap:** default 60 lines total across global + project (configurable). Order:
1. `pinned`
2. `type: user` and `type: feedback`
3. everything else by `used`, newest first

Lines past the cap are omitted from the index. The files stay on disk and remain greppable.

**Promotion:** a project memory moves to global `topics/` when its type is `user` or `feedback`, or when the distiller finds the same fact in two or more projects. The file moves and the project index line is removed.

**First-run import:** existing auto-memory folders (`~/.claude/projects/*/memory/*.md`, excluding `MEMORY.md`) are copied into the matching `projects/<slug>/topics/`, with frontmatter filled in (`verified` = file mtime, `sources: []`). The originals are left untouched. The import runs once and is recorded in `.state.json`.

## 3. Hooks and session wiring

All wiring applies only to Claude sessions that ClaudeCodeMax launches. Global Claude Code settings are never modified.

`launchClaude()` in `src/main/index.ts` adds `--plugin-dir <memory dir>` (skills, §6), plus:
- `--settings <userData>/ccm-hooks.json`, a settings file the app writes at startup, registering three hooks. Each one runs `node <resources>/memory-hook.js <event>`:
  - `SessionStart` → `start`
  - `SessionEnd` → `enqueue`
  - `PreCompact` → `enqueue`
- `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` in the pty env, so the built-in auto memory is off only inside the app.

**`memory-hook.js`** is a single dependency-free Node script:
- **All events:** exits 0 immediately if `CCM_DISTILLER=1`.
- **`start`:**
  - reads the hook JSON from stdin (`cwd`, `session_id`);
  - resolves the project folder (see §7, project identity);
  - prints the global `INDEX.md`, the project `INDEX.md`, and one fixed instruction line as SessionStart additional context: *"Memory lives in `<dir>`. Read a topic file when its index line is relevant; Grep the folder for anything else."*;
  - writes the injected byte size to `.state.json`.
  - It does no git work (except the remote lookup for an unmatched project), makes no model or network calls, and on any error prints nothing and exits 0.
- **`enqueue`:** appends `{transcript_path, session_id, cwd}` to `.queue` and exits. Target: well under 100ms.

## 4. Distiller (writing memory)

A runner in the Electron main process (`src/main/memory/runner.ts`) watches `.queue` and processes one job at a time.

**Catch-up:** at app start, any `~/.claude/projects/*/*.jsonl` that has grown past its saved offset is queued. This covers sessions run outside the app. The distiller's own transcripts (the memory folder's slug) are always skipped.

**Per job:**
1. **Slice:**
   - Read the transcript from the saved offset.
   - Keep user messages and assistant text.
   - Keep tool calls as their name only, except `Read`/`Edit`/`Write`, which keep the file path.
   - Drop tool outputs.
   - Cap at ~20k tokens, keeping the newest part.
   - Skip the job if the slice is under ~2k tokens (still advance the offset).
2. **Record use:** any memory file read in the slice gets `used` set to today and `uses` incremented. This is done in code, before the model runs.
3. **Distill:** run `claude -p --model <memory.model>` with:
   - cwd = memory folder;
   - `CCM_DISTILLER=1`;
   - allowed tools: `Read Write Edit Glob Grep`.

   The prompt includes the slice, both indexes, the file-format rules from §2, the `.rejected` list, and these rules:
   - Save only facts that are **non-obvious and lasting**. Nothing derivable from the code, git history or `CLAUDE.md`.
   - Update an existing memory rather than create a duplicate.
   - When the slice contradicts a memory, rewrite it and set `verified` to today.
   - Never store credentials, tokens, keys or `.env` contents.
   - Apply the promotion rule.
   - Skills only go to `inbox/` (see §6).
4. **Validate:**
   - Every changed `.md` must parse (required frontmatter keys present, topic ≤ 200 lines).
   - A secret scan over changed files must find no matches for `sk-`, `ghp_`, `github_pat_`, `AKIA`, `xox[bp]-` or `-----BEGIN`.
   - Any failure → `git checkout . && git clean -fd`, log the reason, drop the job. Its offset is still advanced, so a poison slice isn't retried forever.
5. **Commit:** rebuild indexes, `git add -A && git commit`, then save the new offset.

**Limits** (in the app's `settings.json`, under `memory`):
- `model`, default `claude-haiku-4-5-20251001`
- `dailyCap`, default 30 runs, counting distill and re-check jobs. Jobs over the cap stay queued for the next day.
- `indexCap`, default 60 lines

**Errors:**
- **`claude -p` exits non-zero or times out** (5 min): the job stays at the head of the queue and is retried at next app start. The failure is logged.
- **App closes mid-job:** the queue is on disk; the offset is only saved after commit.
- **Log output** goes to the same ring buffer pattern `Service` uses, exposed through the existing `service:log` channel as `memory`.

Distiller cost appears in Codeburn automatically, because each run is a normal Claude session with a transcript.

## 5. Expiry and re-checks

The runner runs expiry after every job and during catch-up.

| Trigger | Check | Action |
|---|---|---|
| Source changed | `git -C <project> log -1 --format=%h -- <file>` ≠ stored hash | `stale: true`, queue a re-check |
| Source deleted | file missing | queue a re-check |
| Unused | `used` older than 30 days (not `user`, `feedback` or `pinned`) | omitted from the index |
| Long unused | `used` older than 90 days (same exemptions) | moved to `archive/` |

Source checks only run for projects whose `project.json` path exists on this machine.

**Re-check job:** Haiku gets the memory file and the current source files and must answer keep, rewrite or delete.
- Keep or rewrite: `verified` set to today, `stale: false`, source hashes updated.
- Delete: file removed.
- Uses the same validate/commit steps and counts against `dailyCap`.

Nothing is lost for good. Deleted and archived memories remain in the memory repo's history.

## 6. Skills

The distiller proposes a skill only when:
- the same multi-step procedure appears in two or more sessions, or
- the user corrected how Claude performs an existing learned skill.

A proposal is written to `inbox/<name>/SKILL.md`, with frontmatter `proposed: new|edit` and `evidence: [session ids]`. Names in `.rejected` are never proposed again.

Approved skills (`skills/`) are made available only to app-launched sessions:
- The memory folder doubles as a Claude Code plugin. It holds `.claude-plugin/plugin.json` (`{ "name": "ccm-memory" }`) next to `skills/`.
- `launchClaude()` passes `--plugin-dir <memory dir>`.
- Skills in `inbox/` are outside `skills/`, so they never load.

## 7. Portability: export, import, sync

**Project identity:** `projects/<slug>/project.json` stores the git `origin` remote (normalized to `host/owner/repo`) and the last known path. When `start` sees a cwd with no matching slug:
1. It runs `git remote get-url origin`.
2. If that matches a `project.json`, it renames the folder to the new slug and updates `path`.
3. Projects without a remote match only by path.

**Export:** writes `claudecodemax-memory-<date>.bundle` (`git bundle create <file> --all`) to a location the user picks.

**Import:** takes a `.bundle`.
- **Empty memory folder:** clone from it.
- **Otherwise:** fetch it and merge. For each conflicting file, keep the side with the newer `verified`; the other side stays in history.
- Then rebuild the indexes.

`.state.json` and `.queue` are gitignored and never travel.

**Sync (off by default):** the setting `memory.syncRemote` holds a private git URL.
- When set, the app runs `git pull --rebase` at startup and `git push` after each commit.
- **Any pull conflict or push failure:** the app runs `git rebase --abort` if needed, sets sync state to `paused: <reason>`, and stops syncing until the user presses **Sync now**.

Export shows a warning that the bundle is unencrypted and should be treated as private.

## 8. Memory tab

A fourth entry in `TABS` (`src/renderer/src/Panels.tsx`). It is a native React view (there is no external tool to embed) that reuses the existing `.empty`, `.muted`, `.log` and button styles.

- **Status line:** memory counts (global / this project), last injected index size in tokens (bytes ÷ 4), queue length, runs left today, sync state.
- **Memories:**
  - project index and global index as lists, with a *may be stale* badge where it applies;
  - selecting one shows the file read-only, with **Open in editor** (`shell.openPath`), **Pin / Unpin** and **Archive**.
- **Inbox:**
  - proposals, with a count badge on the tab label when non-empty;
  - each shows its evidence and the proposed `SKILL.md`, and for `edit` proposals the current and proposed versions side by side;
  - **Approve** → move to `skills/`; **Reject** → delete the proposal and append its name to `.rejected`.
- **Value:**
  - distiller and re-check tokens for the last 7 days, summed from their transcripts;
  - average injected index tokens, next to the old auto-memory ceiling (25KB);
  - memory reads by Claude;
  - stale memories caught by re-checks.
- **Settings** (collapsed): model, daily cap, index cap, sync remote, plus **Export**, **Import** and **Sync now**.

**IPC** (preload `window.api` + `ipcMain.handle`, same pattern as today):
- `memory:list`, `memory:read`, `memory:pin`, `memory:archive`
- `inbox:approve`, `inbox:reject`
- `memory:export`, `memory:import`, `memory:sync`

`AppState` gains `memory: { inbox: number; queue: number; sync: 'off' | 'ok' | string }`, pushed over the existing `state` channel.

## 9. Testing

Vitest, matching the existing suite. Tests use `CCM_MEMORY_DIR` pointing at a temp dir.

- Index generation: format, cap, ordering (pinned > user/feedback > recency), stale suffix.
- Frontmatter validation and the secret scan (including a rollback on a planted `ghp_` token).
- Transcript slicing: offsets, tool-output stripping, token cap, resume after restart, against a fixture `.jsonl`.
- Use tracking from `Read` paths in a slice.
- Expiry triggers against a temp git repo: changed source → stale, deleted source → re-check, 30/90-day decay, exemptions.
- `memory-hook.js`:
  - `start` output within the cap;
  - `enqueue` appends a line;
  - exits silently when `CCM_DISTILLER=1` and on malformed input.
- Project identity remap by remote.
- Export → import round trip between two temp dirs, including the newer-`verified` conflict rule.
- Runner end to end with a fake `claude` on PATH (the same approach as the existing smoke test) that writes a fixed memory file.

## 10. Phases

Each phase ships on its own.

1. **Core:**
   - file tree, `memory-hook.js`, `ccm-hooks.json` wiring, runner, distiller;
   - generated indexes, expiry and re-checks;
   - auto-memory import, `user.md`, promotion.
2. **Memory tab:** status line, memory list with pin and archive, value panel, settings, export, import and sync.
3. **Skills:** proposals, inbox, approved-skill loading.

## 11. Verified assumptions

Checked against Claude Code docs and `claude --help` on 2026-09-24:
- `--settings <file>` merges with user, project and local settings, and list values combine rather than replace. The user's own hooks keep running alongside ours. Phase 1's smoke test asserts this with a user-level hook present.
- `--plugin-dir <path>` loads a plugin from a directory for one session (§6).
- `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` disables built-in auto memory. `autoMemoryEnabled: false` is the settings equivalent; it is not used, so the user's settings stay untouched.
