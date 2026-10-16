# Finding 1: Test against real Claude Code (plan)

Author: Opus planner (read-only), saved by the orchestrator. Do not commit.

**Goal:** make the parsers agree with what real Claude Code 2.1.301 writes. Fix three mismatches. Add small scrubbed fixtures with real key shapes, an opt-in real e2e, and a manual checklist.

## (a) Findings (real data vs parsers)

**Statusline (`resources/statusline.mjs`, `src/main/usage.ts`): matches, no code change.** Real JSON has session_id, transcript_path, model{id,display_name}, cost{total_cost_usd}, context_window{used_percentage}, prompt_cache{warm,expires_at,ttl,...}, rate_limits{five_hour,seven_day}{used_percentage,resets_at}. Timestamps are epoch seconds. `basename(transcript_path,'.jsonl') === session_id`, so `resumeFlag`'s check is right. `slugFor` matches real folder names. `--fork-session` is opt-in, so `--resume <id>` keeps writing the same file.

**Transcript, handled correctly:** assistant content split one block per line; `api-request-blob` lines (ignored, only user/assistant are read); attachment, queued_command, queue-operation, system:*, last-prompt, ai-title, file-history-*; task-notification user lines (start with `<`); compact summaries in tasks.ts.

**Mismatches to fix:**
- **M1 (both parsers):** `isApiErrorMessage` assistant lines (rate limit, login expired, server error) become the task reply, so the task looks finished; transcript.ts feeds the text to the distiller.
- **M2 (memory/transcript.ts only):** does not skip `isCompactSummary` / `isVisibleInTranscriptOnly`; ~17 KB summaries fill ~20% of the 80k-char window.
- **M3 (tasks.ts ~line 45):** `JSON.stringify(content).includes('[Request interrupted')` also matches inside `tool_result` content. Real interrupts are only a plain string or a text block.

## (b) Changes

### 1. `src/main/tasks.ts`
- Skip condition (~line 41): append `|| o.isApiErrorMessage`.
- Interrupt check (~lines 45-48): look at plain text only, not tool results:
```ts
const c = o.message?.content
const plain = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(b => b?.type === 'text').map(b => String(b.text)).join('\n') : ''
if (plain.trimStart().startsWith(INTERRUPT)) {
  if (t) t.unfinished = true
  continue
}
```

### 2. `src/main/memory/transcript.ts` line ~36
```ts
if (o.isMeta || o.isSidechain || o.isCompactSummary || o.isVisibleInTranscriptOnly || o.isApiErrorMessage) continue
```

### 3. New fixture `test/fixtures/transcript-real.jsonl`
One JSON object per line. Real key shapes, all values invented. Do not paste anything from real transcripts. `C` below stands for this fragment, expanded into each line that ends with `,C}`:
`"cwd":"C:\\proj","sessionId":"00000000-0000-4000-8000-000000000001","version":"2.1.301","userType":"external","entrypoint":"cli","gitBranch":"main"`

```
{"type":"permission-mode","permissionMode":"default","sessionId":"00000000-0000-4000-8000-000000000001"}
{"type":"file-history-snapshot","messageId":"u1","snapshot":{},"isSnapshotUpdate":false}
{"parentUuid":null,"isSidechain":false,"promptId":"p1","type":"user","message":{"role":"user","content":"Add a health check"},"uuid":"u1","timestamp":"2026-10-16T10:00:00.000Z","permissionMode":"default","origin":{"kind":"human"},"promptSource":"typed","turnOrigin":"human","turnPosition":{"promptIndex":0,"turnIndex":0},C}
{"parentUuid":"u1","isSidechain":false,"message":{"model":"claude-sonnet-5-5","id":"msg_1","type":"message","role":"assistant","content":[{"type":"thinking","thinking":"","signature":"x"}],"stop_reason":null},"requestId":"req_1","type":"assistant","uuid":"u2","timestamp":"2026-10-16T10:00:01.000Z",C}
{"parentUuid":"u2","isSidechain":false,"message":{"model":"claude-sonnet-5-5","id":"msg_1","type":"message","role":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"Write","input":{"file_path":"C:\\proj\\src\\health.ts","content":"x"},"caller":{"type":"direct"}}],"stop_reason":"tool_use"},"requestId":"req_1","type":"assistant","uuid":"u3","timestamp":"2026-10-16T10:00:02.000Z",C}
{"type":"api-request-blob","sessionId":"00000000-0000-4000-8000-000000000001","hash":"h1","message":{"role":"user","content":[{"type":"text","text":"BLOB TEXT MUST BE IGNORED"}]}}
{"parentUuid":"u3","isSidechain":false,"promptId":"p1","type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_1","type":"tool_result","content":"file quotes [Request interrupted by user] in a comment","is_error":false}]},"uuid":"u4","timestamp":"2026-10-16T10:00:03.000Z","toolUseResult":{"type":"create"},"sourceToolAssistantUUID":"u3",C}
{"type":"queue-operation","operation":"enqueue","timestamp":"2026-10-16T10:00:04.000Z","sessionId":"00000000-0000-4000-8000-000000000001","content":"also log it"}
{"parentUuid":"u4","isSidechain":false,"attachment":{"type":"queued_command","prompt":"also log it","source_uuid":"q1","delivery_id":"d1","commandMode":"prompt","origin":{"kind":"human"},"timestamp":"2026-10-16T10:00:04.000Z","humanTurn":true},"type":"attachment","uuid":"u5","timestamp":"2026-10-16T10:00:05.000Z","rendered":[{"content":"also log it"}],"renderedRole":"user",C}
{"type":"queue-operation","operation":"remove","timestamp":"2026-10-16T10:00:05.000Z","sessionId":"00000000-0000-4000-8000-000000000001","content":"also log it","reason":"absorbed_mid_turn","commandUuid":"q1","deliveryId":"d1"}
{"parentUuid":"u5","isSidechain":false,"message":{"model":"claude-sonnet-5-5","id":"msg_2","type":"message","role":"assistant","content":[{"type":"text","text":"Added the endpoint.\n\nSkipped the tests."}],"stop_reason":"end_turn"},"requestId":"req_2","type":"assistant","uuid":"u6","timestamp":"2026-10-16T10:00:06.000Z",C}
{"parentUuid":"u6","isSidechain":false,"type":"system","subtype":"turn_duration","durationMs":6000,"messageCount":6,"timestamp":"2026-10-16T10:00:06.000Z","uuid":"u7","isMeta":false,C}
{"parentUuid":"u7","isSidechain":false,"promptId":"p2","type":"user","message":{"role":"user","content":"<command-name>/model</command-name>\n            <command-message>model</command-message>\n            <command-args>haiku</command-args>"},"uuid":"u8","timestamp":"2026-10-16T10:30:00.000Z",C}
{"parentUuid":"u8","isSidechain":false,"type":"system","subtype":"local_command","content":"<local-command-stdout>Set model to Haiku</local-command-stdout>","level":"info","timestamp":"2026-10-16T10:30:00.000Z","uuid":"u9","isMeta":false,C}
{"parentUuid":"u9","isSidechain":false,"promptId":"p3","type":"user","message":{"role":"user","content":"<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification>"},"uuid":"u10","timestamp":"2026-10-16T10:40:00.000Z","origin":{"kind":"task-notification"},"promptSource":"system","turnOrigin":"task_notification",C}
{"parentUuid":"u10","isSidechain":false,"promptId":"p4","type":"user","message":{"role":"user","content":"Check the build"},"uuid":"u11","timestamp":"2026-10-16T11:00:00.000Z","origin":{"kind":"human"},"promptSource":"typed","turnOrigin":"human",C}
{"parentUuid":"u11","isSidechain":false,"type":"assistant","uuid":"u12","timestamp":"2026-10-16T11:00:01.000Z","message":{"id":"e1","model":"<synthetic>","role":"assistant","stop_reason":"stop_sequence","type":"message","content":[{"type":"text","text":"You've hit your session limit · resets 3pm"}]},"error":"rate_limit","isApiErrorMessage":true,C}
{"parentUuid":"u12","isSidechain":false,"promptId":"p5","type":"user","message":{"role":"user","content":"Rename the route"},"uuid":"u13","timestamp":"2026-10-16T12:00:00.000Z","origin":{"kind":"human"},"promptSource":"typed","turnOrigin":"human",C}
{"parentUuid":"u13","isSidechain":false,"message":{"model":"claude-sonnet-5-5","id":"msg_3","type":"message","role":"assistant","content":[{"type":"tool_use","id":"toolu_2","name":"Bash","input":{"command":"ls"},"caller":{"type":"direct"}}],"stop_reason":"tool_use"},"type":"assistant","uuid":"u14","timestamp":"2026-10-16T12:00:01.000Z",C}
{"parentUuid":"u14","isSidechain":false,"type":"user","message":{"role":"user","content":[{"type":"text","text":"[Request interrupted by user for tool use]"}]},"uuid":"u15","timestamp":"2026-10-16T12:00:02.000Z",C}
{"parentUuid":"u15","isSidechain":false,"type":"system","subtype":"compact_boundary","content":"Conversation compacted","timestamp":"2026-10-16T12:10:00.000Z","uuid":"u16","level":"info",C}
{"parentUuid":"u16","isSidechain":false,"type":"user","message":{"role":"user","content":"This session is being continued from a previous conversation that ran out of context. Summary: example."},"isCompactSummary":true,"isVisibleInTranscriptOnly":true,"uuid":"u17","timestamp":"2026-10-16T12:10:01.000Z",C}
{"type":"last-prompt","leafUuid":"u17","sessionId":"00000000-0000-4000-8000-000000000001","lastPrompt":"Rename the route"}
```

### 4. New fixture `test/fixtures/statusline-real.json`
All values fake.
```json
{"session_id":"00000000-0000-4000-8000-000000000001","transcript_path":"C:\\Users\\me\\.claude\\projects\\C--proj\\00000000-0000-4000-8000-000000000001.jsonl","cwd":"C:\\proj","scratchpad_dir":"C:\\tmp\\scratch","prompt_id":"p1","effort":{"level":"high"},"session_name":"example","model":{"id":"claude-sonnet-5-5","display_name":"Sonnet 5.5"},"workspace":{"current_dir":"C:\\proj","project_dir":"C:\\proj","added_dirs":[],"repo":{"host":"github.com","owner":"example","name":"proj"}},"version":"2.1.301","output_style":{"name":"default"},"cost":{"total_cost_usd":0.42,"total_duration_ms":60000,"total_api_duration_ms":20000,"total_lines_added":10,"total_lines_removed":2},"context_window":{"total_input_tokens":30000,"total_output_tokens":2000,"context_window_size":1000000,"current_usage":{"input_tokens":10,"output_tokens":200,"cache_creation_input_tokens":500,"cache_read_input_tokens":29000},"used_percentage":3,"remaining_percentage":97},"exceeds_200k_tokens":false,"prompt_cache":{"warm":true,"caching_observed":true,"ttl":"1h","expires_at":1800003000,"requests":5,"misses":1,"expected_rebuilds":0,"hit_ratio":0.9,"cache_write_tokens":500,"miss_recache_tokens":0,"last_miss_at":1799999000,"last_miss_cause":{"causes":["example"]},"miss_causes":{"likely_server_side":0},"recache_tokens_if_cold":30000},"fast_mode":false,"thinking":{"enabled":true},"rate_limits":{"five_hour":{"used_percentage":12,"resets_at":1800003600},"seven_day":{"used_percentage":20,"resets_at":1800200000}}}
```

### 5. Tests
Load fixtures with `readFileSync(new URL('./fixtures/<name>', import.meta.url), 'utf8')`. Write the failing assertions first, confirm M1/M2/M3 assertions fail, then apply changes 1 and 2.

**`test/tasks.test.ts`**: new `describe('parseTranscript on a real 2.1.301 transcript')`. Use `rel = f => f.replace('C:\\proj\\', '').replace(/\\/g, '/')`.
- asked texts equal `['Add a health check', 'Check the build', 'Rename the route']` (/model dropped; blob, task notification, compact summary are not tasks).
- Task 0: `files` = `['src/health.ts']`; `added` = `['also log it']`; `note` = `'Skipped the tests.'`; `unfinished` false (M3); `skipFlag` true.
- Task 1: `reply` = `''`, `unfinished` true (M1).
- Task 2: `unfinished` true.
- No task's `reply` or `asked` contains `BLOB`.

**`test/memory-transcript.test.ts`**: write the fixture into the test's temp dir, call `sliceTranscript`.
- `text` contains `USER: Add a health check`, `CLAUDE: Added the endpoint.`, `TOOL: Write C:\proj\src\health.ts`.
- `text` does not contain `BLOB`, `This session is being continued` (M2), `session limit` (M1).
- `cwd` is `'C:\\proj'`.

**`test/usage.test.ts`**: two new tests.
- `parseUsage(real, 1_800_000_000, true)` equals `{ model: 'Sonnet 5.5', cost: 0.42, context: 3, fiveHour: { pct: 12, resetsAt: 1800003600 }, week: { pct: 20, resetsAt: 1800200000 }, cacheExpiresAt: 1800003000, sessionId: '00000000-0000-4000-8000-000000000001' }` (check the real signature and field names first; adjust to what `parseUsage` actually returns).
- statusline script: `execFileSync(process.execPath, ['resources/statusline.mjs'], { input: text, env: { ...process.env, CCM_USAGE_FILE: <tmp>/usage.json } })`; stdout equals `'5h 12% · context 3%'`; saved file equals the input byte for byte. (Verify the env var name and output format in `resources/statusline.mjs`; adjust.)

## (c) Opt-in real e2e
- `package.json`: add `"e2e:real": "vitest run test/real-claude.test.ts"`. Run from PowerShell: `$env:CCM_REAL_CLAUDE=1; npm run e2e:real`. Plain `npm test` reports it skipped (check vitest.config.ts include globs pick it up).
- New `test/real-claude.test.ts` (~40 lines), `describe.skipIf(!process.env.CCM_REAL_CLAUDE)`, 180 s timeout per test.
  - `cwd = realpathSync.native(mkdtempSync(join(tmpdir(), 'ccm-real-')))`, `id = randomUUID()`, `dir = join(homedir(), '.claude', 'projects', slugFor(cwd))`.
  - Run with `runShell` from `src/main/run.ts`, `{ cwd, env: { ...process.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' } }`. Use `--setting-sources project` so the user's plugins/hooks stay out. Do NOT use `--bare` (disables OAuth, breaks Max login).
    1. `claude -p --setting-sources project --model haiku --session-id ${id} "Reply with only the word apple"`
    2. `claude -p --setting-sources project --model <MODEL2> --resume ${id} "Reply with only the word pear"`
  - **MODEL2 depends on the user's decision:** A = `sonnet` (default; proves an actual switch), B = `haiku`.
  - Assert: both exit 0 (put output in the failure message); `existsSync(join(dir, id + '.jsonl'))` and exactly one `.jsonl` in `dir` (no fork); `resumeFlag(id, dir) === ' --resume ' + id`; `parseTranscript(text)` gives exactly 2 tasks with the two prompts as `asked`, non-empty replies, `unfinished` false; assistant models (excluding `<synthetic>`): first includes `haiku`, last includes `MODEL2`; `sliceTranscript(file, 0)` has `cwd === cwd` and `text` containing `USER: Reply with only the word apple`.
  - `afterAll`: `rmSync(dir, { recursive: true, force: true })` (only the project folder this test created) and `rmSync(cwd, { recursive: true, force: true })`.
- Do not run the e2e as part of verification unless the orchestrator says so (it spends real plan usage).

## (d) Manual checklist (put in README or docs; run after each `claude update`, plus `e2e:real`)
1. Send one prompt. Status bar shows 5h and week %, context, cost, model; `%APPDATA%\ClaudeCodeMax\usage.json` updates.
2. Switch model in the dropdown mid-conversation. Same conversation resumes; no new `.jsonl` in `~/.claude/projects/<slug>`; model shown updates after the next reply.
3. Toggle Lean or Headroom before typing anything. Claude starts fresh with no "No conversation found".
4. Type `/clear`, then toggle Lean right away. The pre-clear conversation must NOT come back (unverified: depends on the status line sending the new session_id before the next reply).
5. Tasks tab: a finished request shows edited files and closing note; one interrupted with Esc shows Unfinished; a message typed mid-turn shows under "You added".
6. Close the session, then check the Memory log for a successful distiller run.

## Risks / not done
- `fake-claude.mjs` status-line JSON stays as is (smoke test asserts its values).
- Replies after a task notification still land on the previous task. Low impact, not fixed.
- The e2e spends a little real plan usage; future CLI flag changes could break it.
- Out of scope: finding 4 (`/model` sync) and finding 5 (slash args).
