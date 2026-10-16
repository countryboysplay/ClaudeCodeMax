# Handoff 02: Tasks tab skip detection (AI classifier)

Read `00-findings-and-process.md` first. Plan: `../plans/2026-10-16-finding-02-skip-detection.md` (incl. FINAL DECISIONS).

## Done (uncommitted)
- Regex `SKIP`/`proseReason` removed. `Task.skipFlag: boolean` is now `Task.skip: 'yes'|'no'|'pending'|'unchecked'`.
- `src/main/skipcheck.ts` (new): `SkipChecker` classifies a reply's last 2 non-empty lines (max 600 chars) with Haiku via `claude -p` (`--tools ""`, `--no-session-persistence`, `--setting-sources project`, `cwd: memDir()`). Verdict cached on disk (`skip-cache.json` in userData, keyed by hash of the prompt+closer), concurrency 2, 60 s timeout, circuit breaker on any failure, `rearm()` on Refresh.
- `readTasks` takes a `verdict` fn; tab shows tasks at once, badge fills in via `tasks:updated`. Unchecked count note under the list.
- User defaults baked into the prompt: stated risk is not a reason; "I didn't run anything" = nothing skipped; note stays last paragraph.
- Env override `CCM_CMD_CLASSIFIER`; fake `test/fixtures/fake-skipcheck.mjs`.

## Verified
- Fail-first on `test/skipcheck.test.ts`.
- Orchestrator re-ran: typecheck clean; `npm test` 23 files passed, 1 skipped; 212 passed, 2 skipped; `npm run smoke` passed (twice).
- Real: `CCM_REAL_CLAUDE=1 npm run e2e:real` 2 passed. The classifier returned `yes` for "Done.\n\nI didn't run the tests." with the real flags on Windows, and no extra transcript appeared in the project folder.

## Real Haiku accuracy (17 invented cases, run once, temp test deleted)
- 16/17 match. Miss: `Done.

I didn't run anything.` -> Haiku said skipped-with-no-reason; the user default says nothing skipped. Prompt wording for that case is not yet strong enough; left as is pending the user. Everything else matched, including the old regex failures ("later", someone else's "didn't", curly apostrophe, question after closer, markdown label).

## Follow-up: classifier moved to Sonnet (user request, uncommitted)
- `SKIP_MODEL = 'sonnet'` in `skipcheck.ts` (own constant; distiller keeps `settings.memory.model` Haiku). Model is part of the cache key, so old Haiku verdicts are not reused. README updated.
- Re-ran: typecheck clean; `npm test` pass; `npm run smoke` pass; `e2e:real` 2 passed; the 17-case real-model check: 17/17 (Haiku was 16/17; Sonnet also treats "I didn't run anything." as nothing skipped).
- Cost: Sonnet is roughly 3x Haiku per token; still about $0.0015 per new closer by the earlier estimate (not measured).

## Not verified
- Unit table uses a fake that returns the expected answer, so it tests plumbing and `closer()`, not the model.
- UI not viewed: needs a new installed build. The user's session runs on the installed release.
- Cost numbers (~$0.0005 per new closer, ~$0.10 for 200 tasks) are estimates.

## Deviations from plan
- Refresh re-arm uses a `refresh` flag on `tasks:get` (not a new IPC); auto-reloads from `tasks:updated` do not re-arm (avoids a loop).
- Bad-JSON replies are retried on Refresh, not at next app start.
- A failed cache write is swallowed. Timeout test uses 1500 ms.

## Known risks
- If `memDir()` is missing at first use the spawn fails and classification stays off until Refresh (the app creates it at startup).
- Breaker is all-or-nothing per run; Refresh re-arms.
- First open of a big project fires up to 200 background Haiku calls.

## Next: finding 14 (Tasks tab = open work)
User decided: show unfinished checklist items (~/.claude/tasks) AND prose plan files (docs/superpowers/plans) vs what was done; finished work and chat behind "Show all". Reuse `SkipChecker`'s cache/queue/breaker pattern for plan-vs-done comparison. Plan it before any code; note it changes the purpose of the tab (project memory says Tasks shows what Claude changed).
