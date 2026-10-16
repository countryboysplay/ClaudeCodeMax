# Handoff 01: Test against real Claude Code

Read `00-findings-and-process.md` first. Plan: `../plans/2026-10-16-finding-01-real-claude.md`.

## Done (uncommitted, in working tree)
- `src/main/tasks.ts`: skips `isApiErrorMessage` lines; interrupt check reads plain text only, so a tool result quoting `[Request interrupted` no longer marks a task unfinished.
- `src/main/memory/transcript.ts`: skips compact summaries, transcript-only lines and API error lines, so the distiller stops re-reading ~17 KB summaries and rate-limit text.
- Fixtures: `test/fixtures/transcript-real.jsonl` (23 lines), `statusline-real.json`. Real 2.1.301 key shapes, invented values.
- Tests: new cases in `tasks.test.ts`, `memory-transcript.test.ts`, `usage.test.ts` (includes the first test of `resources/statusline.mjs`).
- Opt-in e2e: `test/real-claude.test.ts`, `npm run e2e:real` (needs `CCM_REAL_CLAUDE=1`). Haiku then `--resume` on Sonnet.
- README (Develop section): e2e note plus a 6-step manual checklist.

## Verified (unit)
- Fail-first: M1 and M3 (tasks) and M2 (memory slice) assertions failed before the fixes, passed after.
- Orchestrator re-ran: `npm run typecheck` clean; `npm test` 22 files passed, 1 skipped; 191 passed, 1 skipped.
- Real statusline JSON and `--resume` / `slugFor` agree with the code (planner read real data on this machine).

## Real e2e result
- Ran `CCM_REAL_CLAUDE=1 npm run e2e:real` on 2026-10-16: 1 passed (not skipped), ~30 s. Confirms against real Claude Code: `--session-id`, `--setting-sources project`, haiku then `--resume` on sonnet in the same transcript (no fork), `slugFor` folder name, `resumeFlag`, `parseTranscript` and `sliceTranscript` on the real file.

## Not verified
- Manual checklist (README) not done: status bar in the live app, dropdown model switch, Lean/Headroom toggle, `/clear` then Lean (item 4 unknown), Tasks tab, Memory log. `-p` mode has no status line, so the e2e cannot cover these.
- `npm run smoke`: passed (1 test, 5.6 s) after the commit; uses the fake claude, so it adds nothing about real Claude.
- The memory-slice API-error assertion (`session limit`) was never seen failing on its own, because the compact-summary assertion failed first.
- Fixtures are hand-written with real key shapes and invented values; they show the parsers handle those shapes, not what Claude emits today. The e2e covers that gap for the simple path only (no tools, errors, compaction).

## Known gaps left alone
- Replies after a task-notification still attach to the previous task.
- `/clear` then Lean toggle (manual checklist item 4) is unconfirmed.

## Next: finding 2
Tasks tab skip detection: parse Ponytail's closing "skipped / risk" line instead of word-searching the whole reply (`src/main/tasks.ts` SKIP, proseReason, `lastParagraph`). Use `test/fixtures/transcript-real.jsonl` (task 0 closes with "Skipped the tests.") as a base for new cases.
