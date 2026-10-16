# Tasks tab design

## Goal

Show, per project, what Claude did on each request, what it decided, and what it left for later, so nothing gets deferred without a reason. It must cost no tokens: no extra model calls and nothing added to Claude's context.

## What the user asked for

- A **Tasks** tab in the panel area, beside Savings and Memory.
- Per task: what was done, the decisions made, and what was deferred.
- A clear way to spot work deferred **without a reason**.
- The cheapest option.

## Data sources (all already on disk)

| Source | Where | Used for |
|---|---|---|
| Session transcripts | `~/.claude/projects/<slug>/*.jsonl`, where `<slug>` is the project path with every non-alphanumeric character replaced by `-` (same as `slugFor` in `src/main/memory/files.ts`) | the tasks |
| Claude Code task files | `~/.claude/tasks/<session-id>/*.json` | a checklist on a task, only when Claude used its task tools (currently never on this machine) |
| Project source code | the open project folder | deferred-work comments |

Checked on this machine on 2026-10-16: transcripts have zero `TodoWrite`/`TaskCreate` calls and `~/.claude/tasks` is empty, so the transcript and code sources carry the feature. The task-file checklist is a small extra.

## What a task is

A task starts at each message the user types (a `type: "user"` line whose `message.content` is a string or has a `text` block, not `isMeta`, not `isSidechain`, and not only `tool_result` blocks). It runs until the next such message. Messages the user sends while Claude is working (`type: "queue-operation"`, `operation: "enqueue"`) belong to the running task and show as "You added".

For each task:

| Field | How it's derived |
|---|---|
| `asked` | the user's message text |
| `added` | mid-turn messages, in order |
| `files` | unique `file_path` values from `Write`, `Edit` and `NotebookEdit` tool calls in the task |
| `note` | the last paragraph of Claude's final text reply in the task, at most 600 characters; the full reply is kept for a "Show full reply" toggle |
| `unfinished` | true when the task contains `[Request interrupted by user` or the session ends with no Claude text reply after the last user message |
| `skipFlag` | true when `note` mentions skipping (`skip`, `skipped`, `didn't`, `did not`, `not checked`, `deferred`, `later`, `left out`, `out of scope`) and gives no reason (`because`, `since`, `until`, `so that`, `to avoid`, `when`, `—`, ` - `) |
| `checklist` | subject and status from `~/.claude/tasks/<session-id>/*.json`, when present |
| `when` | timestamp of the user's message |

Tasks are listed newest first, at most 200 per project. File changes made through Bash or PowerShell aren't captured, and the tab says so.

## Deferred work

The tab's second section lists every comment in the project matching `shortcut:`, `ponytail:`, `TODO` or `FIXME`. Each entry shows the file, line and text, and links to the file.

- An entry has a reason when its text after the marker contains `, ` or ` — ` or ` - `, or one of the reason words above. Ponytail's format is `shortcut: <the limit>, <when to upgrade>`.
- Entries without a reason are listed first and marked **No reason given**.
- Files come from `git ls-files` when the project is a git repo. Otherwise it walks the folder, skipping `node_modules`, `.git`, `dist`, `out`, `build` and `.venv`. Files over 1 MB and binary files are skipped. The scan stops at 20,000 files and says so if it does.

## UI

- A new **Tasks** tab. With no project open, it says to open one.
- Top: the deferred-work summary, for example "3 deferred items, 1 with no reason". It's collapsible and starts expanded when anything has no reason.
- Below: the task list. Each task is a card with the request (two lines, expandable), time, badges (**Unfinished**, **Skipped: check why**), files changed and Claude's note.
- A **Refresh** button. Data loads when the tab opens and on Refresh. There's no file watching.
- It follows the existing styles, keyboard path and contrast rules.

## Code

| Unit | Responsibility |
|---|---|
| `src/main/tasks.ts` | `readTasks(projectDir, claudeProjects, claudeTasks)` returns the task list; pure parsing in `parseTranscript(text)` |
| `src/main/deferred.ts` | `scanDeferred(projectDir)` returns the deferred items; `hasReason(text)` is shared with the `skipFlag` check |
| `src/shared/types.ts` | the `Task` and `Deferred` types |
| `src/main/index.ts`, `src/preload/index.ts` | one `tasks:get` IPC call |
| `src/renderer/src/Panels.tsx` | the `TasksView` tab |

## Testing

- Unit tests for `parseTranscript` with a sample transcript covering: a normal task, tool results that must not start tasks, a mid-turn message, an interrupt, a session that ends mid-task, and a sidechain message.
- Unit tests for `hasReason` and `scanDeferred`, run on a temp folder.
- The smoke test opens the Tasks tab and checks that it renders.

## Out of scope

- Model-written summaries (option B) and logging by Claude as it works (option A), because both cost tokens.
- Editing or deleting tasks from the tab.
- Sessions in other folders, such as a temp clone of the project.
