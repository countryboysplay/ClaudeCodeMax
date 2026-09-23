# ClaudeCodeMax — Design Spec

Date: 2026-09-23
Status: Approved in brainstorming, pending written-spec review

## 1. Goal

A Windows 11 desktop app that puts Claude Code and four companion tools in one window:

| Tool | Repo | License | Role in the app |
|---|---|---|---|
| Headroom | headroomlabs-ai/headroom | Apache-2.0 | Local proxy that compresses context; savings dashboard |
| Graphify | Graphify-Labs/graphify | Apache-2.0 | Codebase knowledge graph (`graph.html`) |
| Codeburn | getagentseal/codeburn | MIT | Token/cost tracking web dashboard |
| Ponytail | dietrichgebert/ponytail | MIT | Claude Code plugin (anti-over-engineering) |

**Audience:** public release on GitHub. No code signing.

**Success criteria**
- A new user on a clean Windows 11 PC runs the installer, completes the first-run wizard, and gets a working Claude Code session with all four tools active, without opening a separate terminal.
- The user opens a project folder and sees the Claude terminal alongside Codeburn cost, the Graphify graph and Headroom savings.
- Quitting the app leaves no orphan processes.

**Non-goals (v1)**
- Multiple terminals/tabs or multiple simultaneous projects.
- Re-implementing any tool's charts or UI. Panels embed each tool's own UI.
- Editing tool settings from the app.
- macOS/Linux builds.
- Bundling Node/Python runtimes.
- Code signing.

## 2. Architecture and layout

```
┌─────────────────────────────────────────────────────────────┐
│ [Project: C:\code\myapp ▾]   Headroom ● on   Ponytail ● on  │
├───────────────────────────────┬─────────────────────────────┤
│                               │ [Cost] [Graph] [Savings]    │
│   Claude Code terminal        │                             │
│   (xterm.js + node-pty,       │   selected tool's web UI    │
│    runs `claude` in project)  │   (<webview>)               │
├───────────────────────────────┴─────────────────────────────┤
│ Status: codeburn ✓  headroom proxy ✓ :8787  graphify ✓      │
└─────────────────────────────────────────────────────────────┘
```

**Stack:** Electron, TypeScript, React (renderer), electron-vite, `@xterm/xterm` + `@xterm/addon-fit`, `node-pty`.

**Main process**
- Owns the project folder selection.
- Runs the service manager (Codeburn web, Headroom proxy).
- Spawns `claude` in a PTY with `cwd` set to the project folder. When Headroom is on, it sets `ANTHROPIC_BASE_URL=http://localhost:<headroomPort>`.
- Kills every child process tree on quit.

**Renderer**
- Terminal on the left, tabbed panel on the right with a resizable split between them, status bar at the bottom.
- Each tab is a `<webview>`.

**Preload**
- A small typed API, the only bridge between the two processes: `openProject`, `pty.write/resize/onData`, `services.status/restart`, `toggles.set`, `setup.run/onProgress`.

**Tool integration**

| Tool | Runtime command | Panel content |
|---|---|---|
| Codeburn | `codeburn web --no-open --port <p>` (default 4747) | `http://localhost:<p>` |
| Headroom | `headroom proxy --port <p>` (default 8787); dashboard via `headroom dashboard` | Headroom dashboard URL (tab shown only while the proxy is running), plus an on/off toggle in the header |
| Graphify | None in the background. The "Build graph" button writes `/graphify .\r` to the PTY | `file://<project>/graphify-out/graph.html` |
| Ponytail | None; it lives inside Claude Code | Header status dot, plus buttons that write `/ponytail-review` or `/ponytail-audit` to the PTY |

Toggling Headroom restarts the Claude session, because `ANTHROPIC_BASE_URL` is read only at launch.

Implementation must check the exact URL and port of the Headroom dashboard, and whether a `--no-open`-style flag exists, against Headroom's docs or `--help`. The design only assumes that it serves a localhost URL.

## 3. First-run setup wizard

**Launch check.** On each launch, the main process runs the check commands below. If any required item is missing, the window shows a checklist in place of the dashboard.

| Step | Required | Check | Install |
|---|---|---|---|
| Git for Windows | yes | `git --version` | `winget install --id Git.Git -e` |
| Node ≥ 22.13 | yes | `node -v` | `winget install --id OpenJS.NodeJS.LTS -e` |
| uv | if Headroom or Graphify is selected | `uv --version` | `winget install --id astral-sh.uv -e` |
| Claude Code | yes | `claude --version` | `powershell -c "irm https://claude.ai/install.ps1 \| iex"` |
| Codeburn | yes | `codeburn --version` | `npm i -g codeburn` |
| Headroom | optional | `headroom --version` | `uv tool install --python 3.13 "headroom-ai[all]"` |
| Graphify | optional | `graphify --version` | `uv tool install graphifyy` then `graphify install` |
| Ponytail | optional | `claude plugin list` output contains `ponytail` | `claude plugin marketplace add DietrichGebert/ponytail` then `claude plugin install ponytail@ponytail` |

**Behaviour**
- Steps run one at a time, each with its output streamed live to a log pane.
- After each winget, npm or uv install, the app rebuilds PATH from the registry (`HKCU\Environment` + `HKLM\...\Session Manager\Environment`) and appends uv's tool bin directory. No reboot or new shell is needed.
- A failed step shows its error with **Retry** and, for optional tools, **Skip**. A skipped tool's panel is greyed out, with an "Install" link that reopens the wizard.
- **Login:** after setup, the app launches `claude` in the terminal so the user signs in through Claude Code's own flow. The app never touches credentials.
- **Tool updates:** a "Check for tool updates" menu item runs `npm update -g codeburn`, `uv tool upgrade headroom-ai graphifyy`, `claude update` and `claude plugin update ponytail@ponytail` (confirm the exact subcommand during implementation). There is no background auto-update of the tools.

## 4. Process management and error handling

**Service module.** One module handles every service. It takes `{ name, command, args, port, healthCheck }` and handles start, stop, health polling and restart.
- **Port selection:** if the default port is taken, pick a free port and pass it to both the service and the Claude environment.
- **Crash:** the status dot turns red. Auto-restart up to 3 times with backoff (1s, 3s, 10s). After that, stop and show a **Restart** button plus the last 50 lines of the service's output.
- **Headroom down while Claude uses it:** show a banner, "Headroom proxy down — restart it or relaunch Claude without it", with both actions as buttons. Never switch Claude off the proxy silently.

**Other failure handling**
- **Claude exits:** the terminal shows "Session ended — [Restart]".
- **Graphify with no graph yet:** an empty state with a **Build graph** button. The app watches `graphify-out/` with `fs.watch` and reloads the tab when `graph.html` changes.
- **Quit:** run `taskkill /PID <pid> /T /F` for every spawned process tree, including the PTY.

**Persistence.** `%APPDATA%\ClaudeCodeMax\settings.json` holds recent projects (up to 10), the Headroom and Ponytail toggles, and the split and tab layout. Nothing else is stored.

**Security**
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` in the renderer.
- A `will-attach-webview` handler strips preloads and enforces the allowlist: `http://localhost:*`, `http://127.0.0.1:*`, and `file://` inside `<project>/graphify-out/`.
- Navigation outside the allowlist opens in the system browser via `shell.openExternal`, and only for `https:` URLs.

## 5. Packaging and updates

- `electron-builder` builds an NSIS installer, per-user (no admin), unsigned: `ClaudeCodeMax-Setup-x.y.z.exe`.
- The README documents the SmartScreen bypass: **More info → Run anyway**.
- `THIRD_PARTY_NOTICES.md` carries the Apache-2.0 and MIT notices for all four tools and for LibreUIUX if any of its assets ship.
- `electron-updater` checks GitHub Releases on launch and prompts "Restart to update".
- A GitHub Actions workflow on `v*` tags builds on `windows-latest` and publishes the release.

## 6. UI/UX process

The UI is built with **LibreUIUX-Claude-Code** (HermeticOrmus/LibreUIUX-Claude-Code, MIT) as the build-time design toolkit. It is not shipped to end users.
- Install its Claude Code plugin, or copy its `design-mastery` agents, skills and commands, into this project's `.claude/`.
- Use its design agents to set the visual direction: colour tokens, typography, spacing, and dark and light themes following the Windows theme.
- Run its critique/review commands on each screen (wizard, dashboard, empty states, error banners) before each screen is considered done.

**Accessibility requirements:** full keyboard navigation, visible focus, WCAG AA contrast, and text labels on status dots (not colour alone).

## 7. Testing

**Unit tests (Vitest)**
- Version parsing and the Node ≥ 22.13 comparison.
- Service restart and backoff logic.
- Free-port selection.
- The webview URL allowlist (the security boundary).
- PATH rebuild merging.

**Wizard**
- Tested against a fake command runner, never real winget.
- Before each release, a manual install is checked on a clean Windows Sandbox or VM.

**Smoke test (Playwright `_electron`)**
- The app launches with a fake `claude` script on PATH.
- The terminal shows its output.
- The Codeburn tab loads from a stub HTTP server.
- After quit, no child PIDs remain.

## 8. Project layout

```
src/
  main/        index.ts, services.ts, pty.ts, setup.ts, path.ts, settings.ts, security.ts
  preload/     index.ts
  renderer/    App.tsx, Terminal.tsx, Panels.tsx, Setup.tsx, StatusBar.tsx, styles/
test/          unit + smoke
.github/workflows/release.yml
THIRD_PARTY_NOTICES.md
```
