# Improvement series: findings and process

Stable file. Read first. Do not edit except to tick a finding's status line at the bottom.

## Process (one finding at a time)
1. Opus **planner** (read-only) writes `docs/superpowers/plans/2026-10-16-finding-NN-<slug>.md`: goal, files to touch, exact steps, tests, risks. Smallest change that fully solves it (ponytail).
2. Sonnet **fixer** implements that plan only, runs `npm run typecheck` and `npm test`, does NOT commit.
3. Orchestrator reviews the diff, then writes `docs/superpowers/handoffs/NN-<slug>.md`: what changed, what was verified, what was not, open risks, next finding. The next agents read the previous handoff plus this file, so the prompt prefix stays identical (cache warm).
4. User approves before commit and before moving on.

## Findings
1. Test against real Claude Code (transcript format, statusline JSON, --resume, model switch); real fixtures; opt-in real e2e.
2. Tasks tab skip detection (`src/main/tasks.ts` SKIP/proseReason): parse Ponytail's closing "skipped / risk" line instead of word-searching the whole reply.
3. Make cost levers visible: savings per lever (Lean tokens saved, Headroom compression, cache hit/miss) in the status bar.
4. `/model` typed in terminal does not update header dropdown; sync from statusline model field.
5. Slash commands shown in Tasks without their arguments.
6. Files outside the project show broken links in Tasks; render plain text or open via OS.
7. Auto-update safety: rollback path, Windows code signing (see electron-builder.yml).
8. release.yml should be gated on typecheck, unit tests, smoke passing for the tag.
9. Split `src/main/index.ts` (448 lines): IPC, PTY, service lifecycle. Only if touched anyway.
10. Crash/error log file plus "Open logs" in the UI.
11. Memory-queue indicator (pending, failed, last run).
12. Repo root tidy: confirm dist, out, test-results are gitignored; decide on repos.md.
13. Two global memory notes that belong to a project (memory: DungeonMasterAI delegation rule, CURRENT_STAGE.md rule).

## Status
- [~] 1 (parser fixes + real e2e pass, uncommitted; manual checklist pending; handoff 01)  - [ ] 2  - [ ] 3  - [ ] 4  - [ ] 5  - [ ] 6  - [ ] 7
- [ ] 8  - [ ] 9  - [ ] 10  - [ ] 11  - [ ] 12  - [ ] 13
