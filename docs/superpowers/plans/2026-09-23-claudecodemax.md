# ClaudeCodeMax Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Windows 11 Electron app that runs Claude Code in an embedded terminal beside panels for Codeburn (cost), Graphify (knowledge graph) and Headroom (token savings), with Ponytail managed as a plugin, and a first-run wizard that installs everything.

**Architecture:** The Electron main process owns everything that touches the OS:
- PATH refresh from the registry
- a shell command runner
- background services with restart and backoff
- the `claude` PTY
- settings
- webview security

These are small, pure-where-possible modules under `src/main/` with Vitest unit tests, wired together in `src/main/index.ts`. A sandboxed preload exposes one typed `window.api`. The React renderer draws the header, terminal (xterm.js), tool panels (`<webview>`), status bar and setup wizard. It only calls `window.api`.

**Tech Stack:**
- Electron, electron-vite, TypeScript, React 18
- `@xterm/xterm` + `@xterm/addon-fit`, `@lydell/node-pty` (prebuilt node-pty, no native build tools needed)
- Vitest, Playwright (`_electron`)
- electron-builder (NSIS), electron-updater

**Spec:** `docs/superpowers/specs/2026-09-23-claudecodemax-design.md`

## Global Constraints

**Platform and packaging**
- Windows 11 x64 only. No macOS/Linux code paths.
- App name `ClaudeCodeMax`. Installer `ClaudeCodeMax-Setup-${version}.exe`, NSIS, per-user, unsigned.
- Settings file: `%APPDATA%\ClaudeCodeMax\settings.json`. That is Electron's `app.getPath('userData')` with productName `ClaudeCodeMax`.
- GitHub repo for releases and updates: `countryboysplay/ClaudeCodeMax`.

**Tool commands and ports**
- Node ≥ 22.13 is required on the user's machine. Use version comparison, never string comparison.
- Default ports: Codeburn 4747, Headroom 8787. If a port is taken, pick a free one.
- Codeburn: `codeburn web --no-open --port <p>`, UI at `http://localhost:<p>`.
- Headroom: `headroom proxy --port <p>`, health `http://127.0.0.1:<p>/stats`, dashboard `http://127.0.0.1:<p>/dashboard`. Claude gets `ANTHROPIC_BASE_URL=http://127.0.0.1:<p>` when Headroom is on.
- Graphify panel: `file://<project>/graphify-out/graph.html`. The "Build graph" button writes `/graphify .\r` to the PTY.
- Ponytail: `claude plugin enable|disable ponytail@ponytail`.

**Services and security**
- Service restart backoff: 1s, 3s, 10s, then `failed`. Keep the last 50 output lines per service.
- Quit kills every spawned process tree with `taskkill /PID <pid> /T /F`.
- Renderer: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webviewTag: true`.
- Webviews may load only `http://localhost:*`, `http://127.0.0.1:*`, or `file://` inside `<project>/graphify-out/`. Anything else is blocked, and `https:` links open in the system browser.

**Out of scope and accessibility**
- No OpenViking. No Context tab. No multiple terminals. No re-implemented charts.
- Accessibility: keyboard reachable everything, visible focus, WCAG AA contrast, status shown as text (not colour only).

**Test and dev seams (environment variables)**
- `CCM_USER_DATA`: overrides the userData folder.
- `CCM_PROJECT`: opens this project at start.
- `CCM_SKIP_SETUP=1`: skips the tool checks.
- `CCM_FORCE_SETUP=1`: always shows the wizard.
- `CCM_CMD_CLAUDE`, `CCM_CMD_CODEBURN`, `CCM_CMD_HEADROOM`: override commands. `{port}` is substituted.
- `CCM_TEST_PIDS`: a folder where test fixtures record their PIDs.

## Review Focus

1. **Project paths with spaces or non-ASCII characters** (e.g. `C:\Users\me\Desktop\Claude Terminal`). The PTY cwd, the graph `file://` URL and the allowlist must all work. Covered by the Task 4 tests (a project path with a space) and the Task 10 smoke test (a temp project named `ccm project …`).
2. **Corrupt, missing or hand-edited `settings.json`.** The app must start with defaults, never crash. Covered by Task 3 `settings.test.ts`.
3. **A default port already in use** (e.g. the user already runs `codeburn web` on 4747). The app picks another free port and uses it consistently. Covered by Task 3 `ports.test.ts`.
4. **Registry PATH with `%VARS%`, duplicates, empty segments or `C:\` roots** after winget installs. PATH is expanded, deduped and kept intact. Covered by Task 2 `path.test.ts`.
5. **Quitting mid-install or mid-restart.** No orphaned winget, npm or service processes, and no restart firing after stop. Covered by Task 2 (`killAll`), Task 5 (stop during backoff) and Task 10 (the orphan check).

---

## File Structure

```
package.json, tsconfig.json, electron.vite.config.ts, vitest.config.ts, playwright.config.ts
electron-builder.yml, .gitignore, README.md, THIRD_PARTY_NOTICES.md
.github/workflows/release.yml
src/shared/types.ts        Types shared by main, preload and renderer (AppState, StepView, …)
src/main/version.ts        parseVersion / atLeast
src/main/path.ts           Rebuild PATH from the registry (parseRegQuery, mergePath, refreshPath)
src/main/run.ts            runShell (streamed shell command), killTree, killAll
src/main/ports.ts          freePort
src/main/settings.ts       defaults / loadSettings / saveSettings / addRecent
src/main/security.ts       isAllowedUrl (pure)
src/main/guard.ts          Electron webview and navigation lockdown using isAllowedUrl
src/main/services.ts       Service class (spawn, health, backoff restart, log ring)
src/main/setup.ts          STEPS, check, install, blockedBy, needsWizard
src/main/index.ts          App lifecycle, window, PTY, IPC, menu, updater wiring
src/preload/index.ts       window.api bridge
src/renderer/index.html
src/renderer/src/main.tsx, env.d.ts, styles.css
src/renderer/src/App.tsx         Mode switch, Dashboard, Header, Divider, Headroom banner
src/renderer/src/Terminal.tsx    xterm + PTY bridge + session-ended / no-project overlays
src/renderer/src/Panels.tsx      Tabs + webviews + empty/failed states
src/renderer/src/StatusBar.tsx   Service status text
src/renderer/src/Setup.tsx       Setup wizard + UpdateOverlay + LogPane
test/*.test.ts                   Vitest unit tests
test/smoke.spec.ts, test/screens.spec.ts   Playwright (Electron)
test/fixtures/fake-claude.cmd, fake-claude.mjs, stub-server.mjs
```

---

### Task 1: Scaffold the project, version parsing, and install LibreUIUX

**Files:**
- Create: `package.json`, `tsconfig.json`, `electron.vite.config.ts`, `vitest.config.ts`, `.gitignore`
- Create: `src/main/index.ts` (temporary minimal window; Task 7 replaces it), `src/preload/index.ts` (temporary, empty bridge)
- Create: `src/renderer/index.html`, `src/renderer/src/main.tsx`
- Create: `src/main/version.ts`
- Test: `test/version.test.ts`

**Interfaces:**
- Produces: `parseVersion(text: string): [number, number, number] | null` and `atLeast(text: string, min: string): boolean`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "claudecodemax",
  "productName": "ClaudeCodeMax",
  "version": "0.1.0",
  "description": "Claude Code with Codeburn, Graphify, Headroom and Ponytail in one Windows app",
  "main": "out/main/index.js",
  "license": "MIT",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "smoke": "electron-vite build && playwright test test/smoke.spec.ts",
    "screens": "electron-vite build && playwright test test/screens.spec.ts",
    "dist": "electron-vite build && electron-builder --win --publish never",
    "release": "electron-vite build && electron-builder --win --publish always"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run:
```bash
npm install @lydell/node-pty electron-updater
npm install -D electron electron-vite vite @vitejs/plugin-react typescript vitest @types/node react@18 react-dom@18 @types/react@18 @types/react-dom@18 @xterm/xterm @xterm/addon-fit @playwright/test electron-builder
```
Expected: installs without errors. If npm reports an `ERESOLVE` peer conflict on `vite`, run `npm view electron-vite peerDependencies`, then reinstall `vite` at the highest major listed there (e.g. `npm install -D vite@6`).

The renderer packages (React, xterm) are devDependencies on purpose. Vite bundles them, so they don't need to ship in `node_modules`.

- [ ] **Step 3: Create config files**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["node"]
  },
  "include": ["src", "test", "*.config.ts"]
}
```

`electron.vite.config.ts`:
```ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { plugins: [react()] }
})
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { include: ['test/**/*.test.ts'], environment: 'node' } })
```

`.gitignore`:
```
node_modules/
out/
dist/
screens/
test-results/
playwright-report/
.claude/settings.local.json
```

- [ ] **Step 4: Create the temporary app shell**

`src/main/index.ts` (temporary; Task 7 replaces the whole file):
```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'ClaudeCodeMax',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true }
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
})
app.on('window-all-closed', () => app.quit())
```

`src/preload/index.ts` (temporary; Task 7 replaces it):
```ts
export {}
```

`src/renderer/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>ClaudeCodeMax</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./src/main.tsx"></script>
  </body>
</html>
```

`src/renderer/src/main.tsx` (temporary; Task 8 replaces it):
```tsx
import { createRoot } from 'react-dom/client'

createRoot(document.getElementById('root')!).render(<h1>ClaudeCodeMax</h1>)
```

- [ ] **Step 5: Verify the shell launches**

Run: `npm run dev`
Expected: a window titled "ClaudeCodeMax" showing the heading "ClaudeCodeMax". Close it.

- [ ] **Step 6: Write the failing version test**

`test/version.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { parseVersion, atLeast } from '../src/main/version'

describe('parseVersion', () => {
  it('reads node style versions', () => expect(parseVersion('v22.13.0')).toEqual([22, 13, 0]))
  it('reads versions embedded in text', () => expect(parseVersion('2.1.3 (Claude Code)')).toEqual([2, 1, 3]))
  it('returns null for garbage', () => expect(parseVersion('not installed')).toBeNull())
})

describe('atLeast', () => {
  it('accepts an exact match', () => expect(atLeast('v22.13.0', '22.13.0')).toBe(true))
  it('compares numerically, not as strings', () => expect(atLeast('v22.9.0', '22.13.0')).toBe(false))
  it('accepts newer majors', () => expect(atLeast('v24.1.0', '22.13.0')).toBe(true))
  it('rejects older patch', () => expect(atLeast('v22.12.9', '22.13.0')).toBe(false))
  it('rejects unparseable input', () => expect(atLeast('', '22.13.0')).toBe(false))
})
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npx vitest run test/version.test.ts`
Expected: FAIL, "Failed to resolve import ../src/main/version".

- [ ] **Step 8: Implement `src/main/version.ts`**

```ts
export function parseVersion(text: string): [number, number, number] | null {
  const m = text.match(/(\d+)\.(\d+)\.(\d+)/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

export function atLeast(text: string, min: string): boolean {
  const a = parseVersion(text)
  const b = parseVersion(min)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return true
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npx vitest run test/version.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 10: Install LibreUIUX design plugins at project scope**

Run:
```bash
claude plugin marketplace add HermeticOrmus/LibreUIUX-Claude-Code
claude plugin install design-mastery@claude-code-workflows --scope project -y
claude plugin install accessibility-compliance@claude-code-workflows --scope project -y
```
Expected: both report installed. `.claude/settings.json` now lists them under `enabledPlugins`. Tasks 8, 9 and 11 use `/design-mastery:style-guide`, `/design-mastery:ui-critique` and `/accessibility-compliance:accessibility-audit`.

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json tsconfig.json electron.vite.config.ts vitest.config.ts .gitignore src test .claude/settings.json
git commit -m "chore: scaffold Electron app, add version parsing, install LibreUIUX plugins"
```

---

### Task 2: PATH refresh and shell runner

**Files:**
- Create: `src/main/path.ts`, `src/main/run.ts`
- Test: `test/path.test.ts`, `test/run.test.ts`

**Interfaces:**
- Produces:
  - `parseRegQuery(out: string): string`
  - `mergePath(parts: string[], env: NodeJS.ProcessEnv): string`
  - `refreshPath(env?: NodeJS.ProcessEnv): void`
  - `type Runner = (command: string, onLine?: (line: string) => void) => Promise<{ code: number; output: string }>`
  - `runShell: Runner`
  - `killTree(pid: number | undefined): void`
  - `killAll(): void`

- [ ] **Step 1: Write the failing PATH tests**

`test/path.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { parseRegQuery, mergePath } from '../src/main/path'

const env = { USERPROFILE: 'C:\\Users\\me', APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }

describe('parseRegQuery', () => {
  it('extracts a REG_EXPAND_SZ Path value', () => {
    const out = '\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    %USERPROFILE%\\bin;C:\\Program Files\\Tools\r\n\r\n'
    expect(parseRegQuery(out)).toBe('%USERPROFILE%\\bin;C:\\Program Files\\Tools')
  })
  it('extracts a REG_SZ Path value', () => {
    expect(parseRegQuery('    Path    REG_SZ    C:\\A\r\n')).toBe('C:\\A')
  })
  it('returns empty string when there is no Path value', () => expect(parseRegQuery('ERROR: not found')).toBe(''))
})

describe('mergePath', () => {
  it('expands %VARS% case-insensitively', () => expect(mergePath(['%userprofile%\\bin'], env)).toBe('C:\\Users\\me\\bin'))
  it('leaves unknown vars untouched', () => expect(mergePath(['%NOPE%\\x'], env)).toBe('%NOPE%\\x'))
  it('dedupes case-insensitively ignoring trailing slashes, first wins', () =>
    expect(mergePath(['C:\\Tools;c:\\tools\\', 'C:\\Other'], env)).toBe('C:\\Tools;C:\\Other'))
  it('drops empty segments', () => expect(mergePath([';;C:\\A;;', ''], env)).toBe('C:\\A'))
  it('keeps drive roots intact', () => expect(mergePath(['C:\\'], env)).toBe('C:\\'))
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/path.test.ts`
Expected: FAIL, "Failed to resolve import ../src/main/path".

- [ ] **Step 3: Implement `src/main/path.ts`**

```ts
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

const MACHINE_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'
const USER_KEY = 'HKCU\\Environment'

export function parseRegQuery(out: string): string {
  const m = out.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/i)
  return m ? m[1].trim() : ''
}

function expandVars(s: string, env: NodeJS.ProcessEnv): string {
  return s.replace(/%([^%]+)%/g, (whole, name: string) => {
    const key = Object.keys(env).find(k => k.toLowerCase() === name.toLowerCase())
    return key ? env[key]! : whole
  })
}

export function mergePath(parts: string[], env: NodeJS.ProcessEnv): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of parts.join(';').split(';')) {
    const p = expandVars(raw.trim(), env)
    const key = p.toLowerCase().replace(/[\\/]+$/, '')
    if (!p || seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  return out.join(';')
}

function readRegPath(key: string): string {
  try {
    return parseRegQuery(execFileSync('reg', ['query', key, '/v', 'Path'], { encoding: 'utf8', windowsHide: true }))
  } catch {
    return ''
  }
}

// Re-read PATH after winget/npm/uv installs so new tools are found without restarting the app.
export function refreshPath(env: NodeJS.ProcessEnv = process.env): void {
  const extras = [join(homedir(), '.local', 'bin'), join(env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'npm')]
  env.Path = mergePath([readRegPath(MACHINE_KEY), readRegPath(USER_KEY), ...extras, env.Path ?? env.PATH ?? ''], env)
}
```

- [ ] **Step 4: Run PATH tests to verify they pass**

Run: `npx vitest run test/path.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Write the failing runner tests**

`test/run.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { runShell, killAll } from '../src/main/run'

describe('runShell', () => {
  it('returns exit code 0 and output', async () => {
    const r = await runShell('echo hello')
    expect(r.code).toBe(0)
    expect(r.output).toContain('hello')
  })
  it('reports a non-zero exit code', async () => expect((await runShell('exit 3')).code).toBe(3))
  it('streams complete lines', async () => {
    const lines: string[] = []
    await runShell('echo one&& echo two', l => lines.push(l.trim()))
    expect(lines).toEqual(['one', 'two'])
  })
  it('killAll stops running commands (no orphans on quit)', async () => {
    const p = runShell('ping -n 30 127.0.0.1')
    await new Promise(r => setTimeout(r, 500))
    killAll()
    expect((await p).code).not.toBe(0)
  }, 15_000)
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run test/run.test.ts`
Expected: FAIL, "Failed to resolve import ../src/main/run".

- [ ] **Step 7: Implement `src/main/run.ts`**

```ts
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'

export type Runner = (command: string, onLine?: (line: string) => void) => Promise<{ code: number; output: string }>

const running = new Set<ChildProcess>()

export const runShell: Runner = (command, onLine) =>
  new Promise(resolve => {
    const child = spawn(command, { shell: true, windowsHide: true, env: process.env })
    running.add(child)
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
      running.delete(child)
      if (partial.trim()) onLine?.(partial)
      resolve({ code, output })
    }
    child.on('error', err => done((output += String(err), -1)))
    child.on('close', code => done(code ?? -1))
  })

export function killTree(pid: number | undefined): void {
  if (!pid) return
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  } catch {
    // already exited
  }
}

export function killAll(): void {
  for (const child of running) killTree(child.pid)
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run test/path.test.ts test/run.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 9: Commit**

```bash
git add src/main/path.ts src/main/run.ts test/path.test.ts test/run.test.ts
git commit -m "feat: PATH refresh from registry and streamed shell runner"
```

---

### Task 3: Free-port selection and settings

**Files:**
- Create: `src/main/ports.ts`, `src/main/settings.ts`
- Test: `test/ports.test.ts`, `test/settings.test.ts`

**Interfaces:**
- Produces:
  - `freePort(preferred: number): Promise<number>`
  - `interface Settings { recent: string[]; headroom: boolean; ponytail: boolean; skipped: string[]; split: number; tab: string }`
  - `defaults(): Settings`
  - `loadSettings(file: string): Settings`
  - `saveSettings(file: string, s: Settings): void`
  - `addRecent(list: string[], dir: string): string[]`

- [ ] **Step 1: Write the failing tests**

`test/ports.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { createServer } from 'node:net'
import { freePort } from '../src/main/ports'

describe('freePort', () => {
  it('returns the preferred port when it is free', async () => {
    const free = await freePort(0)
    expect(await freePort(free)).toBe(free)
  })
  it('returns a different port when the preferred one is taken', async () => {
    const srv = createServer().listen(0, '127.0.0.1')
    await new Promise(r => srv.once('listening', r))
    const taken = (srv.address() as { port: number }).port
    const got = await freePort(taken)
    srv.close()
    expect(got).not.toBe(taken)
    expect(got).toBeGreaterThan(0)
  })
})
```

`test/settings.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaults, loadSettings, saveSettings, addRecent } from '../src/main/settings'

const dir = mkdtempSync(join(tmpdir(), 'ccm-settings-'))

describe('loadSettings', () => {
  it('returns defaults when the file is missing', () => expect(loadSettings(join(dir, 'none.json'))).toEqual(defaults()))
  it('returns defaults when the file is corrupt', () => {
    const f = join(dir, 'corrupt.json')
    writeFileSync(f, '{not json')
    expect(loadSettings(f)).toEqual(defaults())
  })
  it('repairs wrong-typed fields', () => {
    const f = join(dir, 'wrong.json')
    writeFileSync(f, JSON.stringify({ recent: 'C:\\x', skipped: null, headroom: false }))
    const s = loadSettings(f)
    expect(s.recent).toEqual([])
    expect(s.skipped).toEqual([])
    expect(s.headroom).toBe(false)
  })
  it('does not share arrays between loads', () => {
    const a = loadSettings(join(dir, 'none.json'))
    a.skipped.push('uv')
    expect(loadSettings(join(dir, 'none.json')).skipped).toEqual([])
  })
  it('round-trips and creates missing folders', () => {
    const f = join(dir, 'nested', 'settings.json')
    saveSettings(f, { ...defaults(), headroom: false, recent: ['C:\\a b'] })
    expect(loadSettings(f)).toMatchObject({ headroom: false, recent: ['C:\\a b'] })
  })
})

describe('addRecent', () => {
  it('moves an existing entry to the front, case-insensitively', () =>
    expect(addRecent(['C:\\A', 'C:\\B'], 'c:\\b')).toEqual(['c:\\b', 'C:\\A']))
  it('caps the list at 10', () => {
    const list = Array.from({ length: 10 }, (_, i) => `C:\\p${i}`)
    const out = addRecent(list, 'C:\\new')
    expect(out).toHaveLength(10)
    expect(out[0]).toBe('C:\\new')
    expect(out).not.toContain('C:\\p9')
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run test/ports.test.ts test/settings.test.ts`
Expected: FAIL, "Failed to resolve import".

- [ ] **Step 3: Implement `src/main/ports.ts`**

```ts
import { createServer } from 'node:net'

function tryListen(port: number): Promise<number | null> {
  return new Promise(resolve => {
    const srv = createServer()
    srv.once('error', () => resolve(null))
    srv.listen(port, '127.0.0.1', () => {
      const got = (srv.address() as { port: number }).port
      srv.close(() => resolve(got))
    })
  })
}

// ponytail: probes 127.0.0.1 only; a service already bound to ::1 alone on the same port is not detected.
export async function freePort(preferred: number): Promise<number> {
  return (await tryListen(preferred)) ?? (await tryListen(0))!
}
```

- [ ] **Step 4: Implement `src/main/settings.ts`**

```ts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export interface Settings {
  recent: string[]
  headroom: boolean
  ponytail: boolean
  skipped: string[]
  split: number
  tab: string
}

export const defaults = (): Settings => ({ recent: [], headroom: true, ponytail: true, skipped: [], split: 0.6, tab: 'cost' })

export function loadSettings(file: string): Settings {
  let parsed: Partial<Settings> = {}
  try {
    const v = JSON.parse(readFileSync(file, 'utf8'))
    if (v && typeof v === 'object' && !Array.isArray(v)) parsed = v
  } catch {
    // missing or corrupt: fall back to defaults
  }
  const s = { ...defaults(), ...parsed }
  s.recent = Array.isArray(s.recent) ? s.recent.filter(x => typeof x === 'string') : []
  s.skipped = Array.isArray(s.skipped) ? s.skipped.filter(x => typeof x === 'string') : []
  return s
}

export function saveSettings(file: string, s: Settings): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(s, null, 2))
}

export function addRecent(list: string[], dir: string): string[] {
  return [dir, ...list.filter(d => d.toLowerCase() !== dir.toLowerCase())].slice(0, 10)
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/ports.test.ts test/settings.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add src/main/ports.ts src/main/settings.ts test/ports.test.ts test/settings.test.ts
git commit -m "feat: free-port selection and resilient settings store"
```

---

### Task 4: Webview URL allowlist and navigation guard

**Files:**
- Create: `src/main/security.ts` (pure), `src/main/guard.ts` (Electron wiring)
- Test: `test/security.test.ts`

**Interfaces:**
- Produces:
  - `isAllowedUrl(raw: string, projectDir: string | null): boolean`
  - `guardWebviews(win: BrowserWindow, getProject: () => string | null): void`

- [ ] **Step 1: Write the failing tests**

`test/security.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isAllowedUrl } from '../src/main/security'

const project = 'C:\\Users\\me\\My Project'
const inGraph = (...p: string[]) => pathToFileURL(join(project, 'graphify-out', ...p)).href

describe('isAllowedUrl', () => {
  it.each([
    'http://localhost:4747',
    'http://localhost:4747/sessions?x=1',
    'http://127.0.0.1:8787/dashboard',
    inGraph('graph.html'),
    inGraph('assets', 'lib.js'),
    'file:///c:/users/me/my%20project/graphify-out/graph.html'
  ])('allows %s', url => expect(isAllowedUrl(url, project)).toBe(true))

  it.each([
    'https://localhost:4747',
    'http://localhost.evil.com',
    'http://127.0.0.2:4747',
    'http://example.com',
    'https://example.com',
    'javascript:alert(1)',
    'not a url',
    pathToFileURL(join(project, 'secret.txt')).href,
    'file:///C:/Users/me/My%20Project/graphify-out/../secret.txt',
    'file:///C:/Users/me/My%20Project/graphify-out-evil/graph.html',
    pathToFileURL(join(project, 'graphify-out')).href,
    'file://evil-host/share/graphify-out/graph.html'
  ])('blocks %s', url => expect(isAllowedUrl(url, project)).toBe(false))

  it('blocks file URLs when no project is open', () => expect(isAllowedUrl(inGraph('graph.html'), null)).toBe(false))
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/security.test.ts`
Expected: FAIL, "Failed to resolve import ../src/main/security".

- [ ] **Step 3: Implement `src/main/security.ts`**

```ts
import { fileURLToPath } from 'node:url'
import { resolve, relative, isAbsolute, join } from 'node:path'

export function isAllowedUrl(raw: string, projectDir: string | null): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol === 'http:') return url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'file:' || !projectDir) return false
  let target: string
  try {
    target = resolve(fileURLToPath(url))
  } catch {
    return false
  }
  const rel = relative(join(projectDir, 'graphify-out'), target)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/security.test.ts`
Expected: PASS (19 tests). If `file://evil-host/…` throws inside `fileURLToPath`, the `try` returns false, which is the intended result.

- [ ] **Step 5: Implement `src/main/guard.ts`**

```ts
import { shell, type BrowserWindow, type WebContents } from 'electron'
import { isAllowedUrl } from './security'

const openExternal = (url: string) => {
  if (url.startsWith('https:')) void shell.openExternal(url)
}

function lockDown(contents: WebContents, allowed: (url: string) => boolean): void {
  contents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (e, url) => {
    if (allowed(url)) return
    e.preventDefault()
    openExternal(url)
  })
}

export function guardWebviews(win: BrowserWindow, getProject: () => string | null): void {
  lockDown(win.webContents, () => false)
  win.webContents.on('will-attach-webview', (e, prefs, params) => {
    delete prefs.preload
    prefs.nodeIntegration = false
    prefs.contextIsolation = true
    prefs.sandbox = true
    if (!isAllowedUrl(params.src, getProject())) e.preventDefault()
  })
  win.webContents.on('did-attach-webview', (_e, contents) => lockDown(contents, url => isAllowedUrl(url, getProject())))
}
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/main/security.ts src/main/guard.ts test/security.test.ts
git commit -m "feat: webview URL allowlist and navigation lockdown"
```

---

### Task 5: Service manager with health checks and backoff restart

**Files:**
- Create: `src/shared/types.ts`, `src/main/services.ts`
- Test: `test/services.test.ts`

**Interfaces:**
- Consumes: `killTree` from `src/main/run.ts`
- Produces:
  - In `src/shared/types.ts`: `Status`, `ServiceName`, `StepView`, `AppState`, `InitResult`, `InstallResult` (full definitions below)
  - `BACKOFF = [1000, 3000, 10000]`
  - `interface ServiceSpec { name: string; command: string; healthUrl: string }`
  - `interface Child`
  - `type Spawner = (command: string) => Child`
  - `type Probe = (url: string) => Promise<boolean>`
  - `class Service extends EventEmitter` with:
    - properties `status: Status` and `log: string[]`
    - methods `start()`, `stop()`, `restart()`
    - a `'status'` event

- [ ] **Step 1: Create `src/shared/types.ts`**

```ts
export type Status = 'stopped' | 'starting' | 'up' | 'restarting' | 'failed'
export type ServiceName = 'codeburn' | 'headroom'

export interface StepView {
  id: string
  label: string
  required: boolean
  ok: boolean
  skipped: boolean
  blockedBy: string | null
}

export interface AppState {
  project: string | null
  recent: string[]
  headroom: boolean
  ponytail: boolean
  split: number
  tab: string
  services: Record<ServiceName, Status>
  ports: Record<ServiceName, number>
  urls: { cost: string; savings: string; graph: string | null }
  graphExists: boolean
  ptyUsesHeadroom: boolean
  installed: Record<string, boolean>
}

export type InitResult = { mode: 'setup'; steps: StepView[] } | { mode: 'dashboard'; state: AppState }

export interface InstallResult {
  ok: boolean
  error?: string
  steps: StepView[]
}
```

- [ ] **Step 2: Write the failing tests**

`test/services.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { Service, type Child } from '../src/main/services'

type Fake = EventEmitter & Child

function fakeChild(): Fake {
  const c = new EventEmitter() as Fake
  c.stdout = new EventEmitter()
  c.stderr = new EventEmitter()
  return c
}

function make(probe: (url: string) => Promise<boolean> = async () => true) {
  const children: Fake[] = []
  const svc = new Service(
    { name: 'x', command: 'x', healthUrl: 'http://x' },
    () => {
      const c = fakeChild()
      children.push(c)
      return c
    },
    probe
  )
  return { svc, children }
}

describe('Service', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('goes up when the health probe passes', async () => {
    const { svc } = make()
    svc.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(svc.status).toBe('up')
  })

  it('stays starting while the probe fails', async () => {
    const { svc } = make(async () => false)
    svc.start()
    await vi.advanceTimersByTimeAsync(2000)
    expect(svc.status).toBe('starting')
  })

  it('restarts with 1s, 3s, 10s backoff, then gives up', async () => {
    const { svc, children } = make()
    svc.start()
    await vi.advanceTimersByTimeAsync(0)
    let expected = 1
    for (const delay of [1000, 3000, 10000]) {
      children.at(-1)!.emit('exit')
      expect(svc.status).toBe('restarting')
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(children).toHaveLength(expected)
      await vi.advanceTimersByTimeAsync(1)
      expect(children).toHaveLength(++expected)
    }
    children.at(-1)!.emit('exit')
    expect(svc.status).toBe('failed')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(children).toHaveLength(4)
  })

  it('stop during backoff cancels the pending restart', async () => {
    const { svc, children } = make()
    svc.start()
    await vi.advanceTimersByTimeAsync(0)
    children[0].emit('exit')
    svc.stop()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(children).toHaveLength(1)
    expect(svc.status).toBe('stopped')
  })

  it('an exit after stop does not restart', async () => {
    const { svc, children } = make()
    svc.start()
    svc.stop()
    children[0].emit('exit')
    await vi.advanceTimersByTimeAsync(20_000)
    expect(children).toHaveLength(1)
    expect(svc.status).toBe('stopped')
  })

  it('start after failure resets the attempt count', async () => {
    const { svc, children } = make()
    svc.start()
    for (let i = 0; i < 4; i++) {
      children.at(-1)!.emit('exit')
      await vi.advanceTimersByTimeAsync(10_000)
    }
    expect(svc.status).toBe('failed')
    svc.start()
    children.at(-1)!.emit('exit')
    expect(svc.status).toBe('restarting')
  })

  it('keeps only the last 50 log lines', () => {
    const { svc, children } = make()
    svc.start()
    const text = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join('\n')
    ;(children[0].stdout as EventEmitter).emit('data', Buffer.from(text))
    expect(svc.log).toHaveLength(50)
    expect(svc.log[0]).toBe('line 11')
  })

  it('emits status events', async () => {
    const { svc } = make()
    const seen: string[] = []
    svc.on('status', s => seen.push(s))
    svc.start()
    await vi.advanceTimersByTimeAsync(0)
    svc.stop()
    expect(seen).toEqual(['starting', 'up', 'stopped'])
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run test/services.test.ts`
Expected: FAIL, "Failed to resolve import ../src/main/services".

- [ ] **Step 4: Implement `src/main/services.ts`**

```ts
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { killTree } from './run'
import type { Status } from '../shared/types'

export const BACKOFF = [1000, 3000, 10000]

export interface ServiceSpec {
  name: string
  command: string
  healthUrl: string
}

export interface Child {
  pid?: number
  stdout: NodeJS.EventEmitter | null
  stderr: NodeJS.EventEmitter | null
  on(event: 'exit', listener: () => void): unknown
}

export type Spawner = (command: string) => Child
export type Probe = (url: string) => Promise<boolean>

const defaultSpawner: Spawner = command => spawn(command, { shell: true, windowsHide: true, env: process.env })
const defaultProbe: Probe = url => fetch(url).then(r => r.status < 500, () => false)

// ponytail: attempts reset only on start(); a service that crashes 3 times over a long session stays failed until the user clicks Restart.
export class Service extends EventEmitter {
  status: Status = 'stopped'
  log: string[] = []
  private child?: Child
  private attempts = 0
  private timer?: NodeJS.Timeout
  private wanted = false

  constructor(
    public spec: ServiceSpec,
    private spawner: Spawner = defaultSpawner,
    private probe: Probe = defaultProbe
  ) {
    super()
  }

  start(): void {
    clearTimeout(this.timer)
    this.wanted = true
    this.attempts = 0
    this.launch()
  }

  stop(): void {
    this.wanted = false
    clearTimeout(this.timer)
    const child = this.child
    this.child = undefined
    killTree(child?.pid)
    this.set('stopped')
  }

  restart(): void {
    this.stop()
    this.start()
  }

  private launch(): void {
    this.set('starting')
    const child = this.spawner(this.spec.command)
    this.child = child
    const feed = (b: Buffer) => {
      this.log.push(...b.toString().split(/\r?\n/).filter(Boolean))
      this.log = this.log.slice(-50)
    }
    child.stdout?.on('data', feed)
    child.stderr?.on('data', feed)
    child.on('exit', () => {
      if (this.child === child) this.onExit()
    })
    void this.waitHealthy(child)
  }

  private async waitHealthy(child: Child): Promise<void> {
    for (let i = 0; i < 60 && this.child === child; i++) {
      if (await this.probe(this.spec.healthUrl)) {
        if (this.child === child) this.set('up')
        return
      }
      await new Promise(r => setTimeout(r, 500))
    }
  }

  private onExit(): void {
    this.child = undefined
    if (!this.wanted) return
    const delay = BACKOFF[this.attempts++]
    if (delay === undefined) return this.set('failed')
    this.set('restarting')
    this.timer = setTimeout(() => this.launch(), delay)
  }

  private set(s: Status): void {
    this.status = s
    this.emit('status', s)
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/services.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/services.ts test/services.test.ts
git commit -m "feat: service manager with health checks and backoff restarts"
```

---

### Task 6: Setup steps (check, install, dependencies)

**Files:**
- Create: `src/main/setup.ts`
- Test: `test/setup.test.ts`

**Interfaces:**
- Consumes: `Runner` from `src/main/run.ts`; `atLeast` from `src/main/version.ts`
- Produces:
  - `interface Step { id; label; required; requires?; check; minVersion?; checkIncludes?; install: string[] }`
  - `STEPS: Step[]`, with ids in order `git, node, uv, claude, codeburn, headroom, graphify, ponytail`
  - `check(step: Step, run: Runner): Promise<boolean>`
  - `install(step: Step, run: Runner, onLine: (l: string) => void): Promise<{ ok: boolean; error?: string }>`
  - `blockedBy(step: Step, results: Record<string, boolean>): string | null`
  - `needsWizard(results: Record<string, boolean>, skipped: string[]): boolean`

- [ ] **Step 1: Write the failing tests**

`test/setup.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { STEPS, check, install, blockedBy, needsWizard } from '../src/main/setup'
import type { Runner } from '../src/main/run'

type Table = Record<string, { code: number; output: string }>

function fakeRunner(table: Table) {
  const calls: string[] = []
  const run: Runner = async (cmd, onLine) => {
    calls.push(cmd)
    const r = table[cmd] ?? { code: 1, output: `'${cmd}' is not recognized as an internal or external command` }
    r.output.split('\n').forEach(l => l && onLine?.(l))
    return r
  }
  return { run, calls }
}

const step = (id: string) => STEPS.find(s => s.id === id)!
const allOk = Object.fromEntries(STEPS.map(s => [s.id, true]))

describe('check', () => {
  it('rejects Node older than 22.13 (numeric compare)', async () =>
    expect(await check(step('node'), fakeRunner({ 'node -v': { code: 0, output: 'v22.9.0' } }).run)).toBe(false))
  it('accepts Node 22.13+', async () =>
    expect(await check(step('node'), fakeRunner({ 'node -v': { code: 0, output: 'v22.13.1' } }).run)).toBe(true))
  it('fails when the command is missing', async () => expect(await check(step('git'), fakeRunner({}).run)).toBe(false))
  it('requires ponytail in the plugin list', async () => {
    const without = fakeRunner({ 'claude plugin list': { code: 0, output: 'superpowers@official' } }).run
    const withIt = fakeRunner({ 'claude plugin list': { code: 0, output: 'ponytail@ponytail  enabled' } }).run
    expect(await check(step('ponytail'), without)).toBe(false)
    expect(await check(step('ponytail'), withIt)).toBe(true)
  })
})

describe('install', () => {
  it('runs commands in order and streams them', async () => {
    const { run, calls } = fakeRunner({
      'uv tool install graphifyy': { code: 0, output: 'Installed graphifyy' },
      'graphify install': { code: 0, output: 'skill registered' }
    })
    const lines: string[] = []
    const r = await install(step('graphify'), run, l => lines.push(l))
    expect(r.ok).toBe(true)
    expect(calls).toEqual(['uv tool install graphifyy', 'graphify install'])
    expect(lines[0]).toBe('> uv tool install graphifyy')
  })
  it('stops at the first failing command and returns its output', async () => {
    const { run, calls } = fakeRunner({ 'uv tool install graphifyy': { code: 2, output: 'network down' } })
    const r = await install(step('graphify'), run, () => {})
    expect(r).toEqual({ ok: false, error: 'network down' })
    expect(calls).toEqual(['uv tool install graphifyy'])
  })
  it('reports the exit code when a failure prints nothing', async () => {
    const { run } = fakeRunner({ 'npm install -g codeburn': { code: 5, output: '' } })
    expect((await install(step('codeburn'), run, () => {})).error).toBe('Exited with code 5')
  })
})

describe('blockedBy', () => {
  it('names the missing dependency', () => expect(blockedBy(step('headroom'), { ...allOk, uv: false })).toBe('uv (Python tools)'))
  it('is null when the dependency is installed', () => expect(blockedBy(step('headroom'), allOk)).toBeNull())
  it('is null for steps without dependencies', () => expect(blockedBy(step('git'), {})).toBeNull())
})

describe('needsWizard', () => {
  it('is false when everything is installed', () => expect(needsWizard(allOk, [])).toBe(false))
  it('is true when a required tool is missing, even if skipped', () =>
    expect(needsWizard({ ...allOk, claude: false }, ['claude'])).toBe(true))
  it('is true when an optional tool is missing and not skipped', () => expect(needsWizard({ ...allOk, headroom: false }, [])).toBe(true))
  it('is false when a missing optional tool was skipped', () => expect(needsWizard({ ...allOk, headroom: false }, ['headroom'])).toBe(false))
})

describe('STEPS', () => {
  it('lists every tool in install order', () =>
    expect(STEPS.map(s => s.id)).toEqual(['git', 'node', 'uv', 'claude', 'codeburn', 'headroom', 'graphify', 'ponytail']))
  it('marks git, node, claude and codeburn as required', () =>
    expect(STEPS.filter(s => s.required).map(s => s.id)).toEqual(['git', 'node', 'claude', 'codeburn']))
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/setup.test.ts`
Expected: FAIL, "Failed to resolve import ../src/main/setup".

- [ ] **Step 3: Implement `src/main/setup.ts`**

```ts
import type { Runner } from './run'
import { atLeast } from './version'

export interface Step {
  id: string
  label: string
  required: boolean
  requires?: string
  check: string
  minVersion?: string
  checkIncludes?: string
  install: string[]
}

const WINGET = '--exact --silent --accept-source-agreements --accept-package-agreements'

export const STEPS: Step[] = [
  { id: 'git', label: 'Git for Windows', required: true, check: 'git --version', install: [`winget install --id Git.Git ${WINGET}`] },
  {
    id: 'node',
    label: 'Node.js 22.13+',
    required: true,
    check: 'node -v',
    minVersion: '22.13.0',
    install: [`winget install --id OpenJS.NodeJS.LTS ${WINGET} || winget upgrade --id OpenJS.NodeJS.LTS ${WINGET}`]
  },
  { id: 'uv', label: 'uv (Python tools)', required: false, check: 'uv --version', install: [`winget install --id astral-sh.uv ${WINGET}`] },
  {
    id: 'claude',
    label: 'Claude Code',
    required: true,
    check: 'claude --version',
    install: ['powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://claude.ai/install.ps1 | iex"']
  },
  { id: 'codeburn', label: 'Codeburn', required: true, requires: 'node', check: 'codeburn --version', install: ['npm install -g codeburn'] },
  {
    id: 'headroom',
    label: 'Headroom',
    required: false,
    requires: 'uv',
    check: 'headroom --version',
    install: ['uv tool install --python 3.13 "headroom-ai[all]"']
  },
  {
    id: 'graphify',
    label: 'Graphify',
    required: false,
    requires: 'uv',
    check: 'graphify --version',
    install: ['uv tool install graphifyy', 'graphify install']
  },
  {
    id: 'ponytail',
    label: 'Ponytail',
    required: false,
    requires: 'claude',
    check: 'claude plugin list',
    checkIncludes: 'ponytail',
    install: ['claude plugin marketplace add DietrichGebert/ponytail', 'claude plugin install ponytail@ponytail -y']
  }
]

export async function check(step: Step, run: Runner): Promise<boolean> {
  const { code, output } = await run(step.check)
  if (code !== 0) return false
  if (step.minVersion && !atLeast(output, step.minVersion)) return false
  if (step.checkIncludes && !output.toLowerCase().includes(step.checkIncludes)) return false
  return true
}

export async function install(step: Step, run: Runner, onLine: (l: string) => void): Promise<{ ok: boolean; error?: string }> {
  for (const cmd of step.install) {
    onLine(`> ${cmd}`)
    const { code, output } = await run(cmd, onLine)
    if (code !== 0) return { ok: false, error: output.trim().split(/\r?\n/).slice(-20).join('\n') || `Exited with code ${code}` }
  }
  return { ok: true }
}

export function blockedBy(step: Step, results: Record<string, boolean>): string | null {
  if (!step.requires || results[step.requires]) return null
  return STEPS.find(s => s.id === step.requires)?.label ?? step.requires
}

export function needsWizard(results: Record<string, boolean>, skipped: string[]): boolean {
  return STEPS.some(s => !results[s.id] && (s.required || !skipped.includes(s.id)))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/setup.test.ts`
Expected: PASS (16 tests).

- [ ] **Step 5: Check the real version commands on this machine**

Run each of these: `git --version`, `node -v`, `uv --version`, `claude --version`, `codeburn --version`, `headroom --version`, `graphify --version`, `claude plugin list`.

Expected: installed tools exit 0. If an installed tool exits non-zero on its `--version`, try `<tool> --help`. If that exits 0, change that step's `check` to it and add a test row in `test/setup.test.ts` for the new command. Record in the commit message which commands you verified.

- [ ] **Step 6: Commit**

```bash
git add src/main/setup.ts test/setup.test.ts
git commit -m "feat: setup steps with version checks, ordered installs, dependency blocking"
```

---

### Task 7: Main process wiring, PTY, IPC, and preload bridge

**Files:**
- Replace: `src/main/index.ts`
- Replace: `src/preload/index.ts`
- Create: `src/renderer/src/env.d.ts`

**Interfaces:**
- Consumes everything from Tasks 1–6:
  - `refreshPath`
  - `runShell`, `killTree`, `killAll`
  - `freePort`
  - `loadSettings`, `saveSettings`, `addRecent`, `Settings`
  - `guardWebviews`
  - `Service`
  - `STEPS`, `check`, `install`, `blockedBy`, `needsWizard`
  - the types in `src/shared/types.ts`
- Produces the renderer API `window.api` (type `Api`).
  - Invokes:
    - `init(): Promise<InitResult>`
    - `getState(): Promise<AppState>`
    - `pickProject(): Promise<void>`
    - `openProject(dir): Promise<boolean>`
    - `restartClaude()`
    - `setHeadroom(on)`
    - `setPonytail(on)`
    - `restartService(name)`
    - `serviceLog(name): Promise<string[]>`
    - `setLayout({split?, tab?})`
    - `setupCheck(): Promise<StepView[]>`
    - `setupInstall(id): Promise<InstallResult>`
    - `setupSkip(id): Promise<StepView[]>`
    - `setupDone(): Promise<AppState>`
    - `updateTools(): Promise<void>`
  - Fire-and-forget sends: `ptyWrite(data)`, `ptyResize(cols, rows)`
  - Event subscriptions, each returning an unsubscribe function:
    - `onPtyData(cb(data))`
    - `onPtyExit(cb())`
    - `onState(cb(AppState))`
    - `onSetupLog(cb(line))`
    - `onGraphChanged(cb())`
    - `onMenu(cb('update' | 'setup'))`

- [ ] **Step 1: Replace `src/main/index.ts`**

```ts
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { existsSync, watchFile, unwatchFile } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { spawn as spawnPty, type IPty } from '@lydell/node-pty'
import { refreshPath } from './path'
import { runShell, killTree, killAll } from './run'
import { freePort } from './ports'
import { loadSettings, saveSettings, addRecent, type Settings } from './settings'
import { guardWebviews } from './guard'
import { Service } from './services'
import { STEPS, check, install, blockedBy, needsWizard } from './setup'
import type { AppState, InitResult, InstallResult, ServiceName, StepView } from '../shared/types'

const REPO_URL = 'https://github.com/countryboysplay/ClaudeCodeMax'
const UPDATE_CMDS = [
  'npm update -g codeburn',
  'uv tool upgrade headroom-ai graphifyy',
  'claude update',
  'claude plugin update ponytail@ponytail'
]

if (process.env.CCM_USER_DATA) app.setPath('userData', process.env.CCM_USER_DATA)
const settingsFile = () => join(app.getPath('userData'), 'settings.json')

let settings: Settings
let win: BrowserWindow
let project: string | null = null
let pty: IPty | null = null
let ptyUsesHeadroom = false
let size = { cols: 120, rows: 30 }
let installed: Record<string, boolean> = {}
let services: Record<ServiceName, Service> | null = null
const ports: Record<ServiceName, number> = { codeburn: 4747, headroom: 8787 }

const override = (name: string, fallback: string) => process.env[`CCM_CMD_${name}`] ?? fallback
const save = () => saveSettings(settingsFile(), settings)
const send = (channel: string, ...args: unknown[]) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
}
const graphFile = () => (project ? join(project, 'graphify-out', 'graph.html') : null)

function state(): AppState {
  const g = graphFile()
  return {
    project,
    recent: settings.recent,
    headroom: settings.headroom,
    ponytail: settings.ponytail,
    split: settings.split,
    tab: settings.tab,
    services: { codeburn: services?.codeburn.status ?? 'stopped', headroom: services?.headroom.status ?? 'stopped' },
    ports: { ...ports },
    urls: {
      cost: `http://localhost:${ports.codeburn}`,
      savings: `http://127.0.0.1:${ports.headroom}/dashboard`,
      graph: g ? pathToFileURL(g).href : null
    },
    graphExists: !!g && existsSync(g),
    ptyUsesHeadroom,
    installed
  }
}
const pushState = () => send('state', state())

// ---- Claude session -------------------------------------------------------

function stopClaude(): void {
  const p = pty
  pty = null
  if (p) killTree(p.pid)
}

function launchClaude(): void {
  stopClaude()
  if (!project) return pushState()
  const env: Record<string, string> = { ...(process.env as Record<string, string>) }
  ptyUsesHeadroom = settings.headroom && installed.headroom !== false
  if (ptyUsesHeadroom) env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${ports.headroom}`
  const p = spawnPty(process.env.ComSpec ?? 'cmd.exe', ['/c', override('CLAUDE', 'claude')], {
    name: 'xterm-256color',
    cwd: project,
    env,
    cols: size.cols,
    rows: size.rows
  })
  pty = p
  p.onData(d => send('pty:data', d))
  p.onExit(() => {
    if (pty !== p) return
    pty = null
    send('pty:exit')
  })
  pushState()
}

function openProject(dir: string): boolean {
  if (!existsSync(dir)) {
    settings.recent = settings.recent.filter(d => d !== dir)
    save()
    pushState()
    return false
  }
  const old = graphFile()
  if (old) unwatchFile(old)
  project = dir
  settings.recent = addRecent(settings.recent, dir)
  save()
  watchFile(graphFile()!, { interval: 2000 }, () => {
    pushState()
    send('graph:changed')
  })
  launchClaude()
  return true
}

async function pickProject(): Promise<void> {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
  if (!r.canceled && r.filePaths[0]) openProject(r.filePaths[0])
}

// ---- Services -------------------------------------------------------------

function syncServices(): void {
  if (!services) return
  if (installed.codeburn !== false && services.codeburn.status === 'stopped') services.codeburn.start()
  if (settings.headroom && installed.headroom !== false && services.headroom.status === 'stopped') services.headroom.start()
}

let started = false
async function startDashboard(): Promise<void> {
  if (started) return
  started = true
  ports.codeburn = await freePort(4747)
  ports.headroom = await freePort(8787)
  const cmdFor = (name: ServiceName, fallback: string) => override(name.toUpperCase(), fallback).replace('{port}', String(ports[name]))
  services = {
    codeburn: new Service({
      name: 'codeburn',
      command: cmdFor('codeburn', 'codeburn web --no-open --port {port}'),
      healthUrl: `http://localhost:${ports.codeburn}`
    }),
    headroom: new Service({
      name: 'headroom',
      command: cmdFor('headroom', 'headroom proxy --port {port}'),
      healthUrl: `http://127.0.0.1:${ports.headroom}/stats`
    })
  }
  for (const s of Object.values(services)) s.on('status', pushState)
  syncServices()
  const first = process.env.CCM_PROJECT ?? settings.recent.find(d => existsSync(d))
  if (first) openProject(first)
  else pushState()
}

// ---- Setup ----------------------------------------------------------------

async function checkAll(): Promise<Record<string, boolean>> {
  const results = await Promise.all(STEPS.map(s => check(s, runShell)))
  installed = Object.fromEntries(STEPS.map((s, i) => [s.id, results[i]]))
  return installed
}

function stepViews(r: Record<string, boolean>): StepView[] {
  return STEPS.map(s => ({
    id: s.id,
    label: s.label,
    required: s.required,
    ok: !!r[s.id],
    skipped: settings.skipped.includes(s.id),
    blockedBy: blockedBy(s, r)
  }))
}

// ---- IPC ------------------------------------------------------------------

function registerIpc(): void {
  const svc = (n: unknown) => (services && (n === 'codeburn' || n === 'headroom') ? services[n] : null)

  ipcMain.handle('app:init', async (): Promise<InitResult> => {
    if (process.env.CCM_SKIP_SETUP) {
      await startDashboard()
      return { mode: 'dashboard', state: state() }
    }
    const r = await checkAll()
    if (process.env.CCM_FORCE_SETUP || needsWizard(r, settings.skipped)) return { mode: 'setup', steps: stepViews(r) }
    await startDashboard()
    return { mode: 'dashboard', state: state() }
  })
  ipcMain.handle('state:get', () => state())
  ipcMain.handle('project:pick', () => pickProject())
  ipcMain.handle('project:open', (_e, dir: unknown) => typeof dir === 'string' && openProject(dir))
  ipcMain.on('pty:write', (_e, data: unknown) => {
    if (typeof data === 'string') pty?.write(data)
  })
  ipcMain.on('pty:resize', (_e, cols: unknown, rows: unknown) => {
    if (typeof cols !== 'number' || typeof rows !== 'number' || cols < 2 || rows < 2) return
    size = { cols: Math.floor(cols), rows: Math.floor(rows) }
    pty?.resize(size.cols, size.rows)
  })
  ipcMain.handle('claude:restart', () => launchClaude())
  ipcMain.handle('toggle:headroom', (_e, on: unknown) => {
    settings.headroom = on === true
    save()
    if (settings.headroom) syncServices()
    else services?.headroom.stop()
    launchClaude()
  })
  ipcMain.handle('toggle:ponytail', async (_e, on: unknown) => {
    settings.ponytail = on === true
    save()
    await runShell(`claude plugin ${settings.ponytail ? 'enable' : 'disable'} ponytail@ponytail`)
    launchClaude()
  })
  ipcMain.handle('service:restart', (_e, n: unknown) => svc(n)?.restart())
  ipcMain.handle('service:log', (_e, n: unknown) => svc(n)?.log ?? [])
  ipcMain.handle('layout:set', (_e, l: { split?: unknown; tab?: unknown } | undefined) => {
    if (typeof l?.split === 'number' && l.split >= 0.2 && l.split <= 0.8) settings.split = l.split
    if (typeof l?.tab === 'string') settings.tab = l.tab
    save()
  })
  ipcMain.handle('setup:check', async () => stepViews(await checkAll()))
  ipcMain.handle('setup:install', async (_e, id: unknown): Promise<InstallResult> => {
    const step = STEPS.find(s => s.id === id)
    if (!step) return { ok: false, error: 'Unknown step', steps: stepViews(installed) }
    const r = await install(step, runShell, line => send('setup:log', line))
    refreshPath()
    const results = await checkAll()
    const ok = results[step.id]
    const error = ok
      ? undefined
      : (r.error ?? `${step.label} installed, but "${step.check}" still fails. Restart ClaudeCodeMax and try again.`)
    return { ok, error, steps: stepViews(results) }
  })
  ipcMain.handle('setup:skip', (_e, id: unknown) => {
    if (typeof id === 'string' && !settings.skipped.includes(id)) {
      settings.skipped.push(id)
      save()
    }
    return stepViews(installed)
  })
  ipcMain.handle('setup:done', async () => {
    await startDashboard()
    syncServices()
    pushState()
    return state()
  })
  ipcMain.handle('tools:update', async () => {
    // Running exes (headroom.exe, claude.exe) are locked on Windows, so stop everything first.
    stopClaude()
    services?.codeburn.stop()
    services?.headroom.stop()
    for (const c of UPDATE_CMDS) {
      send('setup:log', `> ${c}`)
      const r = await runShell(c, l => send('setup:log', l))
      if (r.code !== 0) send('setup:log', `(exit ${r.code}, continuing)`)
    }
    refreshPath()
    await checkAll()
    syncServices()
    launchClaude()
  })
}

// ---- Window, menu, lifecycle ----------------------------------------------

function buildMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'File',
        submenu: [
          { label: 'Open Project…', accelerator: 'CmdOrCtrl+Shift+O', click: () => void pickProject() },
          { type: 'separator' },
          { role: 'quit' }
        ]
      },
      {
        label: 'Tools',
        submenu: [
          { label: 'Check for tool updates', click: () => send('menu', 'update') },
          { label: 'Re-run setup', click: () => send('menu', 'setup') }
        ]
      },
      { role: 'viewMenu' },
      {
        label: 'Help',
        submenu: [
          { label: 'Third-party licenses', click: () => void shell.openExternal(`${REPO_URL}/blob/main/THIRD_PARTY_NOTICES.md`) }
        ]
      }
    ])
  )
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'ClaudeCodeMax',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1c' : '#f3f3f3',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  })
  guardWebviews(win, () => project)
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win.isMinimized()) win.restore()
    win.focus()
  })
  app.whenReady().then(() => {
    refreshPath()
    settings = loadSettings(settingsFile())
    registerIpc()
    buildMenu()
    createWindow()
  })
  app.on('before-quit', () => {
    stopClaude()
    if (services) for (const s of Object.values(services)) s.stop()
    killAll()
  })
  app.on('window-all-closed', () => app.quit())
}
```

- [ ] **Step 2: Replace `src/preload/index.ts`**

```ts
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AppState, InitResult, InstallResult, StepView } from '../shared/types'

function on<T extends unknown[]>(channel: string) {
  return (cb: (...args: T) => void) => {
    const handler = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...(args as T))
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.off(channel, handler)
    }
  }
}

const api = {
  init: (): Promise<InitResult> => ipcRenderer.invoke('app:init'),
  getState: (): Promise<AppState> => ipcRenderer.invoke('state:get'),
  pickProject: (): Promise<void> => ipcRenderer.invoke('project:pick'),
  openProject: (dir: string): Promise<boolean> => ipcRenderer.invoke('project:open', dir),
  ptyWrite: (data: string) => ipcRenderer.send('pty:write', data),
  ptyResize: (cols: number, rows: number) => ipcRenderer.send('pty:resize', cols, rows),
  restartClaude: (): Promise<void> => ipcRenderer.invoke('claude:restart'),
  setHeadroom: (on: boolean): Promise<void> => ipcRenderer.invoke('toggle:headroom', on),
  setPonytail: (on: boolean): Promise<void> => ipcRenderer.invoke('toggle:ponytail', on),
  restartService: (name: string): Promise<void> => ipcRenderer.invoke('service:restart', name),
  serviceLog: (name: string): Promise<string[]> => ipcRenderer.invoke('service:log', name),
  setLayout: (l: { split?: number; tab?: string }): Promise<void> => ipcRenderer.invoke('layout:set', l),
  setupCheck: (): Promise<StepView[]> => ipcRenderer.invoke('setup:check'),
  setupInstall: (id: string): Promise<InstallResult> => ipcRenderer.invoke('setup:install', id),
  setupSkip: (id: string): Promise<StepView[]> => ipcRenderer.invoke('setup:skip', id),
  setupDone: (): Promise<AppState> => ipcRenderer.invoke('setup:done'),
  updateTools: (): Promise<void> => ipcRenderer.invoke('tools:update'),
  onPtyData: on<[string]>('pty:data'),
  onPtyExit: on<[]>('pty:exit'),
  onState: on<[AppState]>('state'),
  onSetupLog: on<[string]>('setup:log'),
  onGraphChanged: on<[]>('graph:changed'),
  onMenu: on<['update' | 'setup']>('menu')
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
```

- [ ] **Step 3: Create `src/renderer/src/env.d.ts`**

```ts
import type { Api } from '../../preload'

declare global {
  interface Window {
    api: Api
  }
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { src?: string }
    }
  }
}

export {}
```

- [ ] **Step 4: Typecheck, test and build**

Run: `npm run typecheck && npm test && npm run build`
Expected: no type errors, all unit tests pass, and `out/main/index.js`, `out/preload/index.js` and `out/renderer/index.html` exist.

- [ ] **Step 5: Verify the main process starts cleanly**

Run: `npm run dev`
Expected: the window opens with the Task 1 heading, and the terminal running `npm run dev` shows no uncaught exceptions. (The renderer doesn't call `init` until Task 8.) Close the window. Then confirm with `tasklist | findstr /i "codeburn headroom"` that no services were started. Services start only on `init`.

- [ ] **Step 6: Commit**

```bash
git add src/main/index.ts src/preload/index.ts src/renderer/src/env.d.ts
git commit -m "feat: main process wiring for PTY, services, setup IPC, menu and preload bridge"
```

---

### Task 8: Dashboard UI (header, terminal, panels, status bar)

**Files:**
- Replace: `src/renderer/src/main.tsx`
- Create: `src/renderer/src/App.tsx`, `src/renderer/src/Terminal.tsx`, `src/renderer/src/Panels.tsx`, `src/renderer/src/StatusBar.tsx`, `src/renderer/src/styles.css`
- Create (stub, completed in Task 9): `src/renderer/src/Setup.tsx`

**Interfaces:**
- Consumes: `window.api` (Task 7) and `AppState`, `Status`, `StepView` (Task 5)
- Produces:
  - `App()`
  - `Terminal({ project })`
  - `Panels({ state, onSetup })`
  - `StatusBar({ state })`
  - `STATUS_TEXT: Record<Status, string>`
  - `Setup({ initial, onDone })`, `UpdateOverlay({ onClose })`. Task 9 fills these in.

- [ ] **Step 1: Replace `src/renderer/src/main.tsx`**

```tsx
import { createRoot } from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import { App } from './App'

// No StrictMode: its double-invoked effects would start two tool updates and double-subscribe the PTY.
createRoot(document.getElementById('root')!).render(<App />)
```

- [ ] **Step 2: Create `src/renderer/src/styles.css`** (baseline tokens; Task 11 refines them with LibreUIUX)

```css
:root {
  color-scheme: light dark;
  --bg: #f3f3f3;
  --surface: #ffffff;
  --border: #d1d1d1;
  --text: #1b1b1b;
  --muted: #5c5c5c;
  --accent: #b4501f;
  --accent-text: #ffffff;
  --ok: #0f7b0f;
  --warn: #8a5300;
  --bad: #c42b1c;
  --focus: #005fb8;
  --term-bg: #ffffff;
  --term-fg: #1b1b1b;
  --radius: 6px;
  font: 14px/1.45 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1c1c1c;
    --surface: #262626;
    --border: #3d3d3d;
    --text: #f0f0f0;
    --muted: #a8a8a8;
    --accent: #e8834f;
    --accent-text: #1c1c1c;
    --ok: #6ccb5f;
    --warn: #fce100;
    --bad: #ff99a4;
    --focus: #60cdff;
    --term-bg: #1c1c1c;
    --term-fg: #f0f0f0;
  }
}
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body { background: var(--bg); color: var(--text); overflow: hidden; }
button, select { font: inherit; color: inherit; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 4px 10px; cursor: pointer; }
button:disabled { opacity: 0.5; cursor: default; }
button.primary { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.muted { color: var(--muted); }
.center { display: grid; place-items: center; height: 100%; margin: 0; }

.app {
  display: grid;
  height: 100%;
  grid-template-rows: auto auto 1fr auto;
  grid-template-areas: 'header header header' 'banner banner banner' 'term divider panels' 'status status status';
}
.header { grid-area: header; display: flex; gap: 12px; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--border); background: var(--surface); }
.header label { display: flex; gap: 6px; align-items: center; min-width: 0; flex: 1; }
.header select { max-width: 60ch; min-width: 0; }
.toggle { display: inline-flex; gap: 6px; align-items: center; }
.toggle .dot-mark { background: var(--muted); }
.toggle.on .dot-mark { background: var(--ok); }
.banner { grid-area: banner; display: flex; gap: 12px; align-items: center; padding: 8px 12px; background: color-mix(in srgb, var(--bad) 15%, var(--surface)); border-bottom: 1px solid var(--bad); }

.terminal-area { grid-area: term; position: relative; min-width: 0; min-height: 0; background: var(--term-bg); }
.terminal { position: absolute; inset: 8px; }
.overlay { position: absolute; inset: 0; display: grid; place-content: center; gap: 8px; text-align: center; background: color-mix(in srgb, var(--bg) 85%, transparent); }

.divider { grid-area: divider; cursor: col-resize; background: var(--border); }
.divider:hover, .divider:focus-visible { background: var(--accent); }
.dragging webview { pointer-events: none; }

.panels { grid-area: panels; display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--surface); }
.tabs { display: flex; gap: 2px; padding: 6px 8px 0; border-bottom: 1px solid var(--border); }
.tabs [role='tab'] { border: 0; border-bottom: 2px solid transparent; border-radius: 0; background: none; }
.tabs [role='tab'][aria-selected='true'] { border-bottom-color: var(--accent); font-weight: 600; }
.panel-body { flex: 1; display: flex; min-height: 0; }
.panel-body webview { flex: 1; border: 0; }
.empty { margin: auto; display: grid; gap: 8px; justify-items: center; text-align: center; padding: 16px; max-width: 60ch; }
.log { max-height: 240px; width: 100%; overflow: auto; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); padding: 8px; font: 12px/1.4 'Cascadia Mono', Consolas, monospace; white-space: pre-wrap; text-align: left; }

.statusbar { grid-area: status; display: flex; gap: 16px; padding: 4px 12px; border-top: 1px solid var(--border); background: var(--surface); font-size: 12px; }
.item { display: inline-flex; gap: 6px; align-items: center; }
.dot-mark { width: 8px; height: 8px; border-radius: 50%; display: inline-block; background: var(--muted); }
.status-up .dot-mark { background: var(--ok); }
.status-starting .dot-mark, .status-restarting .dot-mark { background: var(--warn); }
.status-failed .dot-mark { background: var(--bad); }

.setup { position: fixed; inset: 0; overflow: auto; background: var(--bg); padding: 32px max(24px, calc(50% - 360px)); display: grid; gap: 16px; align-content: start; }
.steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.step { display: grid; grid-template-columns: 1fr auto auto auto; gap: 8px; align-items: center; padding: 10px 12px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
.step.ok .step-status { color: var(--ok); }
.step.missing .step-status { color: var(--warn); }
.step-error { grid-column: 1 / -1; margin: 0; color: var(--bad); white-space: pre-wrap; font: 12px/1.4 'Cascadia Mono', Consolas, monospace; }
.actions { display: flex; gap: 8px; justify-content: flex-end; }
```

- [ ] **Step 3: Create `src/renderer/src/StatusBar.tsx`**

```tsx
import type { AppState, Status } from '../../shared/types'

export const STATUS_TEXT: Record<Status, string> = {
  stopped: 'stopped',
  starting: 'starting',
  up: 'running',
  restarting: 'restarting',
  failed: 'failed'
}

function Item({ label, status }: { label: string; status: Status }) {
  return (
    <span className={`item status-${status}`}>
      <span className="dot-mark" aria-hidden="true" />
      {label}: {STATUS_TEXT[status]}
    </span>
  )
}

export function StatusBar({ state }: { state: AppState }) {
  return (
    <footer className="statusbar">
      <Item label="Codeburn" status={state.services.codeburn} />
      {state.headroom && <Item label={`Headroom proxy :${state.ports.headroom}`} status={state.services.headroom} />}
      <span className="item">Graphify: {state.graphExists ? 'graph ready' : 'no graph yet'}</span>
    </footer>
  )
}
```

- [ ] **Step 4: Create `src/renderer/src/Terminal.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

export function Terminal({ project }: { project: string | null }) {
  const host = useRef<HTMLDivElement>(null)
  const term = useRef<XTerm>()
  const [ended, setEnded] = useState(false)

  useEffect(() => {
    const t = new XTerm({
      fontFamily: '"Cascadia Mono", Consolas, monospace',
      fontSize: 14,
      cursorBlink: true,
      theme: { background: cssVar('--term-bg'), foreground: cssVar('--term-fg'), cursor: cssVar('--accent') }
    })
    const fit = new FitAddon()
    t.loadAddon(fit)
    t.open(host.current!)
    term.current = t
    t.attachCustomKeyEventHandler(e => {
      if (e.type === 'keydown' && e.ctrlKey && e.shiftKey && e.code === 'KeyC' && t.hasSelection()) {
        void navigator.clipboard.writeText(t.getSelection())
        return false
      }
      return true
    })
    const resize = () => {
      fit.fit()
      window.api.ptyResize(t.cols, t.rows)
    }
    resize()
    t.onData(d => window.api.ptyWrite(d))
    const ro = new ResizeObserver(resize)
    ro.observe(host.current!)
    const offs = [
      window.api.onPtyData(d => {
        setEnded(false)
        t.write(d)
      }),
      window.api.onPtyExit(() => setEnded(true))
    ]
    return () => {
      offs.forEach(off => off())
      ro.disconnect()
      t.dispose()
    }
  }, [])

  useEffect(() => {
    term.current?.reset()
    setEnded(false)
  }, [project])

  return (
    <main className="terminal-area">
      <div ref={host} className="terminal" aria-label="Claude Code terminal" />
      {ended && (
        <div className="overlay" role="alert">
          <p>Session ended</p>
          <button onClick={() => void window.api.restartClaude()}>Restart</button>
        </div>
      )}
      {!project && (
        <div className="overlay">
          <p>Open a project folder to start Claude Code.</p>
          <button className="primary" onClick={() => void window.api.pickProject()}>
            Open folder…
          </button>
        </div>
      )}
    </main>
  )
}
```

- [ ] **Step 5: Create `src/renderer/src/Panels.tsx`**

```tsx
import { useEffect, useState, type KeyboardEvent } from 'react'
import type { AppState, Status } from '../../shared/types'
import { STATUS_TEXT } from './StatusBar'

const TABS = [
  { id: 'cost', label: 'Cost' },
  { id: 'graph', label: 'Graph' },
  { id: 'savings', label: 'Savings' }
]

function Missing({ tool, onSetup }: { tool: string; onSetup: () => void }) {
  return (
    <div className="empty">
      <p>{tool} isn't installed.</p>
      <button onClick={onSetup}>Install {tool}</button>
    </div>
  )
}

function ServiceView({ name, label, status, url }: { name: string; label: string; status: Status; url: string }) {
  const [log, setLog] = useState<string[]>([])
  useEffect(() => {
    if (status === 'failed') void window.api.serviceLog(name).then(setLog)
  }, [status, name])
  if (status === 'up') return <webview src={url} />
  if (status === 'failed')
    return (
      <div className="empty" role="alert">
        <p>{label} stopped after 3 restart attempts.</p>
        <button onClick={() => void window.api.restartService(name)}>Restart {label}</button>
        <pre className="log">{log.join('\n') || 'No output captured.'}</pre>
      </div>
    )
  return (
    <div className="empty" role="status">
      <p>
        {label} is {STATUS_TEXT[status]}…
      </p>
    </div>
  )
}

export function Panels({ state, onSetup }: { state: AppState; onSetup: () => void }) {
  const [tab, setTab] = useState(TABS.some(t => t.id === state.tab) ? state.tab : 'cost')
  const [graphVersion, setGraphVersion] = useState(0)
  useEffect(() => window.api.onGraphChanged(() => setGraphVersion(v => v + 1)), [])

  const select = (id: string) => {
    setTab(id)
    void window.api.setLayout({ tab: id })
  }
  const onKey = (e: KeyboardEvent) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!d) return
    const i = TABS.findIndex(t => t.id === tab)
    const next = TABS[(i + d + TABS.length) % TABS.length].id
    select(next)
    document.getElementById(`tab-${next}`)?.focus()
  }

  function body() {
    if (tab === 'cost') {
      if (state.installed.codeburn === false) return <Missing tool="Codeburn" onSetup={onSetup} />
      return <ServiceView name="codeburn" label="Codeburn" status={state.services.codeburn} url={state.urls.cost} />
    }
    if (tab === 'savings') {
      if (state.installed.headroom === false) return <Missing tool="Headroom" onSetup={onSetup} />
      if (!state.headroom)
        return (
          <div className="empty">
            <p>Headroom is off.</p>
            <button onClick={() => void window.api.setHeadroom(true)}>Turn on Headroom</button>
          </div>
        )
      return <ServiceView name="headroom" label="Headroom" status={state.services.headroom} url={state.urls.savings} />
    }
    if (state.installed.graphify === false) return <Missing tool="Graphify" onSetup={onSetup} />
    if (!state.project)
      return (
        <div className="empty">
          <p>Open a project to see its knowledge graph.</p>
        </div>
      )
    if (!state.graphExists)
      return (
        <div className="empty">
          <p>No graph for this project yet.</p>
          <button className="primary" onClick={() => window.api.ptyWrite('/graphify .\r')}>
            Build graph
          </button>
        </div>
      )
    return <webview key={graphVersion} src={state.urls.graph!} />
  }

  return (
    <section className="panels" aria-label="Tool panels">
      <div role="tablist" className="tabs" aria-label="Tools">
        {TABS.map(t => (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            role="tab"
            aria-selected={tab === t.id}
            aria-controls="tabpanel"
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => select(t.id)}
            onKeyDown={onKey}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id="tabpanel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="panel-body">
        {body()}
      </div>
    </section>
  )
}
```

- [ ] **Step 6: Create the `src/renderer/src/Setup.tsx` stub** (Task 9 replaces it)

```tsx
import type { AppState, StepView } from '../../shared/types'

export function Setup({ onDone }: { initial: StepView[]; onDone: (s: AppState) => void }) {
  return (
    <div className="setup">
      <h1>Setup</h1>
      <button className="primary" onClick={async () => onDone(await window.api.setupDone())}>
        Continue
      </button>
    </div>
  )
}

export function UpdateOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="setup">
      <button onClick={onClose}>Close</button>
    </div>
  )
}
```

- [ ] **Step 7: Create `src/renderer/src/App.tsx`**

```tsx
import { useEffect, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { AppState, StepView } from '../../shared/types'
import { Terminal } from './Terminal'
import { Panels } from './Panels'
import { StatusBar } from './StatusBar'
import { Setup, UpdateOverlay } from './Setup'

function Toggle(props: { label: string; on: boolean; available: boolean; onChange: (v: boolean) => void; onInstall: () => void }) {
  if (!props.available)
    return (
      <button className="toggle off" onClick={props.onInstall}>
        {props.label}: not installed — Install
      </button>
    )
  return (
    <button className={`toggle ${props.on ? 'on' : 'off'}`} aria-pressed={props.on} onClick={() => props.onChange(!props.on)}>
      <span className="dot-mark" aria-hidden="true" />
      {props.label} {props.on ? 'on' : 'off'}
    </button>
  )
}

function Header({ state, onSetup }: { state: AppState; onSetup: () => void }) {
  const choose = (v: string) => void (v === '__pick' ? window.api.pickProject() : window.api.openProject(v))
  return (
    <header className="header">
      <label>
        Project
        <select value={state.project ?? ''} onChange={e => choose(e.target.value)}>
          {!state.project && <option value="">No project</option>}
          {state.recent.map(d => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
          <option value="__pick">Open folder…</option>
        </select>
      </label>
      <Toggle
        label="Headroom"
        on={state.headroom}
        available={state.installed.headroom !== false}
        onChange={v => void window.api.setHeadroom(v)}
        onInstall={onSetup}
      />
      <Toggle
        label="Ponytail"
        on={state.ponytail}
        available={state.installed.ponytail !== false}
        onChange={v => void window.api.setPonytail(v)}
        onInstall={onSetup}
      />
      {state.ponytail && state.installed.ponytail !== false && state.project && (
        <>
          <button onClick={() => window.api.ptyWrite('/ponytail-review\r')}>Ponytail review</button>
          <button onClick={() => window.api.ptyWrite('/ponytail-audit\r')}>Ponytail audit</button>
        </>
      )}
    </header>
  )
}

function Divider({ split, onChange }: { split: number; onChange: (v: number) => void }) {
  const commit = (v: number) => {
    const c = Math.min(0.8, Math.max(0.2, v))
    onChange(c)
    return c
  }
  const drag = (e: ReactPointerEvent) => {
    e.preventDefault()
    document.body.classList.add('dragging')
    const move = (ev: PointerEvent) => commit(ev.clientX / window.innerWidth)
    const up = (ev: PointerEvent) => {
      document.body.classList.remove('dragging')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      void window.api.setLayout({ split: commit(ev.clientX / window.innerWidth) })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const key = (e: KeyboardEvent) => {
    const d = e.key === 'ArrowLeft' ? -0.05 : e.key === 'ArrowRight' ? 0.05 : 0
    if (d) void window.api.setLayout({ split: commit(split + d) })
  }
  return (
    <div
      className="divider"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize terminal and panels"
      aria-valuenow={Math.round(split * 100)}
      aria-valuemin={20}
      aria-valuemax={80}
      tabIndex={0}
      onPointerDown={drag}
      onKeyDown={key}
    />
  )
}

function Dashboard({ state, onSetup }: { state: AppState; onSetup: () => void }) {
  const [split, setSplit] = useState(state.split)
  const headroomDown = state.ptyUsesHeadroom && ['restarting', 'failed', 'stopped'].includes(state.services.headroom)
  return (
    <div className="app" style={{ gridTemplateColumns: `${split * 100}% 6px 1fr` }}>
      <Header state={state} onSetup={onSetup} />
      {headroomDown && (
        <div className="banner" role="alert">
          <span>Headroom proxy is down, so Claude can't reach the API.</span>
          <button onClick={() => void window.api.restartService('headroom')}>Restart Headroom</button>
          <button onClick={() => void window.api.setHeadroom(false)}>Relaunch Claude without Headroom</button>
        </div>
      )}
      <Terminal project={state.project} />
      <Divider split={split} onChange={setSplit} />
      <Panels state={state} onSetup={onSetup} />
      <StatusBar state={state} />
    </div>
  )
}

export function App() {
  const [mode, setMode] = useState<'loading' | 'setup' | 'dashboard'>('loading')
  const [steps, setSteps] = useState<StepView[]>([])
  const [state, setState] = useState<AppState | null>(null)
  const [updating, setUpdating] = useState(false)

  const openSetup = async () => {
    setSteps(await window.api.setupCheck())
    setMode('setup')
  }

  useEffect(() => {
    void window.api.init().then(r => {
      if (r.mode === 'setup') {
        setSteps(r.steps)
        setMode('setup')
      } else {
        setState(r.state)
        setMode('dashboard')
      }
    })
    const offs = [
      window.api.onState(setState),
      window.api.onMenu(item => {
        if (item === 'setup') void openSetup()
        if (item === 'update') setUpdating(true)
      })
    ]
    return () => offs.forEach(off => off())
  }, [])

  if (mode === 'loading')
    return (
      <p className="center" role="status">
        Checking your tools…
      </p>
    )
  return (
    <>
      {state && <Dashboard state={state} onSetup={() => void openSetup()} />}
      {mode === 'setup' && (
        <Setup
          initial={steps}
          onDone={s => {
            setState(s)
            setMode('dashboard')
          }}
        />
      )}
      {updating && <UpdateOverlay onClose={() => setUpdating(false)} />}
    </>
  )
}
```

- [ ] **Step 8: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: no errors.

- [ ] **Step 9: Run the dashboard against fake tools**

In a PowerShell terminal:
```powershell
$env:CCM_SKIP_SETUP='1'; $env:CCM_PROJECT="$PWD"; $env:CCM_CMD_CLAUDE='cmd /k echo FAKE CLAUDE'; npm run dev
```
Expected:
- The terminal shows `FAKE CLAUDE`, and typing echoes in cmd.
- The header shows this folder.
- Dragging the divider resizes both sides; arrow keys on the focused divider do the same.
- Arrow keys switch tabs.
- The Cost tab shows the real Codeburn dashboard if Codeburn is installed, otherwise a "starting…" state.
- The Graph tab shows "Build graph".

Close the window, then run `tasklist | findstr /i "codeburn node"`. No codeburn process should remain.

- [ ] **Step 10: First design review with LibreUIUX**

In Claude Code in this repo, run `/design-mastery:ui-critique` and paste a screenshot of the running dashboard (`Win+Shift+S`). Apply only findings about clarity, hierarchy, spacing or contrast that change `styles.css` or copy text. Skip any finding that adds features. Rerun Step 9 to confirm.

- [ ] **Step 11: Commit**

```bash
git add src/renderer
git commit -m "feat: dashboard UI with terminal, tool panels, status bar and resizable split"
```

---

### Task 9: Setup wizard and tool-update overlay

**Files:**
- Replace: `src/renderer/src/Setup.tsx`

**Interfaces:**
- Consumes:
  - `window.api.setupCheck`, `setupInstall`, `setupSkip`, `setupDone`, `updateTools`, `onSetupLog`
  - `StepView`, `AppState`
- Produces:
  - `Setup({ initial: StepView[]; onDone: (s: AppState) => void })`
  - `UpdateOverlay({ onClose: () => void })`

- [ ] **Step 1: Replace `src/renderer/src/Setup.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import type { AppState, StepView } from '../../shared/types'

function useLog(): string[] {
  const [lines, setLines] = useState<string[]>([])
  useEffect(() => window.api.onSetupLog(l => setLines(x => [...x.slice(-500), l])), [])
  return lines
}

function LogPane({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLPreElement>(null)
  useEffect(() => {
    ref.current?.scrollTo(0, ref.current.scrollHeight)
  }, [lines])
  return (
    <pre ref={ref} className="log" role="log" aria-label="Install log">
      {lines.join('\n') || 'Output from installers appears here.'}
    </pre>
  )
}

const statusText = (s: StepView) => (s.ok ? 'Installed' : s.skipped ? 'Skipped' : s.blockedBy ? `Needs ${s.blockedBy}` : 'Not installed')
const stepClass = (s: StepView) => (s.ok ? 'ok' : s.skipped ? 'skipped' : 'missing')

export function Setup({ initial, onDone }: { initial: StepView[]; onDone: (s: AppState) => void }) {
  const [steps, setSteps] = useState(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const log = useLog()

  async function installOne(id: string): Promise<StepView[]> {
    setBusy(id)
    const r = await window.api.setupInstall(id)
    setBusy(null)
    setSteps(r.steps)
    setErrors(e => ({ ...e, [id]: r.ok ? '' : (r.error ?? 'Install failed') }))
    return r.steps
  }

  async function installAll() {
    let current = steps
    for (const { id } of steps) {
      const s = current.find(x => x.id === id)!
      if (s.ok || s.skipped || s.blockedBy) continue
      current = await installOne(id)
    }
  }

  async function skip(id: string) {
    setSteps(await window.api.setupSkip(id))
  }

  async function finish() {
    for (const s of steps) if (!s.ok && !s.required && !s.skipped) await window.api.setupSkip(s.id)
    onDone(await window.api.setupDone())
  }

  const ready = steps.every(s => s.ok || !s.required)
  const anythingToInstall = steps.some(s => !s.ok && !s.skipped && !s.blockedBy)

  return (
    <div className="setup" role="dialog" aria-modal="true" aria-labelledby="setup-title">
      <h1 id="setup-title">Set up ClaudeCodeMax</h1>
      <p>
        ClaudeCodeMax runs Claude Code together with Codeburn, Headroom, Graphify and Ponytail. Required tools must be installed. Optional
        ones can be skipped and installed later from Tools → Re-run setup.
      </p>
      <ul className="steps">
        {steps.map(s => (
          <li key={s.id} className={`step ${stepClass(s)}`}>
            <span>
              {s.label}
              {!s.required && <span className="muted"> (optional)</span>}
            </span>
            <span className="step-status">{busy === s.id ? 'Installing…' : errors[s.id] ? 'Failed' : statusText(s)}</span>
            {!s.ok && busy !== s.id && !s.blockedBy ? (
              <button disabled={!!busy} onClick={() => void installOne(s.id)}>
                {errors[s.id] ? 'Retry' : 'Install'}
              </button>
            ) : (
              <span />
            )}
            {!s.ok && !s.required && !s.skipped ? (
              <button disabled={!!busy} onClick={() => void skip(s.id)}>
                Skip
              </button>
            ) : (
              <span />
            )}
            {errors[s.id] && <pre className="step-error">{errors[s.id]}</pre>}
          </li>
        ))}
      </ul>
      <div className="actions">
        <button disabled={!!busy || !anythingToInstall} onClick={() => void installAll()}>
          Install everything missing
        </button>
        <button className="primary" disabled={!!busy || !ready} onClick={() => void finish()}>
          Continue
        </button>
      </div>
      <p className="muted">
        After setup, open a project folder. Claude Code starts in the terminal. Sign in there the first time.
      </p>
      <LogPane lines={log} />
    </div>
  )
}

export function UpdateOverlay({ onClose }: { onClose: () => void }) {
  const log = useLog()
  const [done, setDone] = useState(false)
  useEffect(() => {
    void window.api.updateTools().then(() => setDone(true))
  }, [])
  return (
    <div className="setup" role="dialog" aria-modal="true" aria-labelledby="update-title">
      <h1 id="update-title">Updating tools</h1>
      <p>Claude Code and the background services stop during the update and restart when it finishes.</p>
      <LogPane lines={log} />
      <div className="actions">
        <button className="primary" disabled={!done} onClick={onClose}>
          {done ? 'Close' : 'Updating…'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: no errors.

- [ ] **Step 3: Try the wizard on this machine (forced)**

Run in PowerShell: `$env:CCM_FORCE_SETUP='1'; npm run dev`

Expected:
- The wizard lists 8 steps, each with its real status for this PC.
- **Skip** on an optional missing step turns it to "Skipped".
- **Continue** is disabled while a required step is missing.
- Clicking **Install** on an already-installed-but-shown step isn't possible, because installed steps show no button.
- If an optional tool is actually missing, install it and watch the log stream. The step should turn "Installed" without restarting the app.
- **Continue** moves on to the dashboard.
- **Tools → Re-run setup** shows the wizard over the dashboard, and the terminal keeps running underneath.
- **Tools → Check for tool updates** streams the four update commands. Claude restarts afterwards.

- [ ] **Step 4: Design review with LibreUIUX**

Run `/design-mastery:ui-critique` with screenshots of the wizard in three states: fresh, mid-install, and a failed step with its error. Apply the clarity, copy and contrast fixes to `Setup.tsx` and `styles.css`. Don't add features. Rerun Step 3.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/Setup.tsx src/renderer/src/styles.css
git commit -m "feat: first-run setup wizard and tool update overlay"
```

---

### Task 10: End-to-end smoke test (Electron + fake tools)

**Files:**
- Create: `playwright.config.ts`, `test/smoke.spec.ts`
- Create: `test/fixtures/fake-claude.cmd`, `test/fixtures/fake-claude.mjs`, `test/fixtures/stub-server.mjs`

**Interfaces:**
- Consumes the env seams from Task 7: `CCM_SKIP_SETUP`, `CCM_USER_DATA`, `CCM_PROJECT`, `CCM_CMD_CLAUDE`, `CCM_CMD_CODEBURN`, `CCM_CMD_HEADROOM`, `CCM_TEST_PIDS`
- Consumes the UI text from Task 8: `Codeburn: running`, tab names `Cost` and `Graph`, button `Build graph`, and the `.xterm-rows` DOM

- [ ] **Step 1: Create the fixtures**

`test/fixtures/fake-claude.cmd`:
```bat
@node "%~dp0fake-claude.mjs" %*
```

`test/fixtures/fake-claude.mjs`:
```js
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

if (process.env.CCM_TEST_PIDS) writeFileSync(join(process.env.CCM_TEST_PIDS, `claude-${process.pid}`), '')
console.log('FAKE CLAUDE READY')
console.log(`ANTHROPIC_BASE_URL=${process.env.ANTHROPIC_BASE_URL ?? '(none)'}`)
process.stdin.on('data', d => process.stdout.write(`echo:${d}`))
setInterval(() => {}, 1 << 30)
```

`test/fixtures/stub-server.mjs`:
```js
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

if (process.env.CCM_TEST_PIDS) writeFileSync(join(process.env.CCM_TEST_PIDS, `stub-${process.pid}`), '')
const port = Number(process.argv[2])
createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end(`<h1>STUB ${port}</h1>`)
}).listen(port)
```

`playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({ testDir: 'test', testMatch: /.*\.spec\.ts/, timeout: 90_000, workers: 1 })
```

- [ ] **Step 2: Write the smoke test**

`test/smoke.spec.ts`:
```ts
import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const fixtures = resolve('test/fixtures')
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test('runs Claude in the project, serves the Cost panel, and leaves no orphans', async () => {
  const pids = mkdtempSync(join(tmpdir(), 'ccm-pids-'))
  const project = mkdtempSync(join(tmpdir(), 'ccm project ')) // space on purpose
  const stub = `node "${join(fixtures, 'stub-server.mjs')}" {port}`
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
      CCM_CMD_HEADROOM: stub
    }
  })
  const win = await app.firstWindow()
  const term = win.locator('.xterm-rows')

  await expect(term).toContainText('FAKE CLAUDE READY', { timeout: 30_000 })
  await expect(term).toContainText('ANTHROPIC_BASE_URL=http://127.0.0.1:')
  await expect(win.getByText('Codeburn: running')).toBeVisible({ timeout: 30_000 })

  await win.getByRole('tab', { name: 'Cost' }).click()
  await expect(win.locator('webview')).toHaveAttribute('src', /^http:\/\/localhost:\d+$/)

  await win.getByRole('tab', { name: 'Graph' }).click()
  await expect(win.getByRole('button', { name: 'Build graph' })).toBeVisible()

  const started = readdirSync(pids).map(f => Number(f.split('-')[1]))
  expect(started.length).toBeGreaterThanOrEqual(3) // claude + codeburn stub + headroom stub

  await app.close()
  await expect.poll(() => started.filter(alive), { timeout: 15_000 }).toEqual([])
})
```

- [ ] **Step 3: Run it**

Run: `npm run smoke`
Expected: PASS (1 test).

If it fails on the orphan check, the app's `before-quit` is not killing a tree. Inspect it with `tasklist /FI "PID eq <pid>"` and fix `stopClaude` or `Service.stop` in the main process. Do not weaken the test.

- [ ] **Step 4: Commit**

```bash
git add playwright.config.ts test/smoke.spec.ts test/fixtures
git commit -m "test: Electron smoke test with fake Claude and stub services"
```

---

### Task 11: Visual design and accessibility pass with LibreUIUX

**Files:**
- Modify: `src/renderer/src/styles.css`, plus copy text in `App.tsx`, `Panels.tsx`, `Setup.tsx`, `Terminal.tsx` where findings require it
- Create: `test/screens.spec.ts`

**Interfaces:**
- Consumes: the env seams (`CCM_FORCE_SETUP`, …) and the fixtures from Task 10
- Produces: PNG screenshots in `screens/` (gitignored) for review

- [ ] **Step 1: Write the screenshot spec**

`test/screens.spec.ts`:
```ts
import { test, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const fixtures = resolve('test/fixtures')
const stub = `node "${join(fixtures, 'stub-server.mjs')}" {port}`
const baseEnv = () => ({
  ...process.env,
  CCM_USER_DATA: mkdtempSync(join(tmpdir(), 'ccm-data-')),
  CCM_CMD_CLAUDE: join(fixtures, 'fake-claude.cmd'),
  CCM_CMD_CODEBURN: stub,
  CCM_CMD_HEADROOM: stub
})

for (const scheme of ['light', 'dark'] as const) {
  test(`dashboard screenshots (${scheme})`, async () => {
    const app = await electron.launch({
      args: ['.'],
      env: { ...baseEnv(), CCM_SKIP_SETUP: '1', CCM_PROJECT: mkdtempSync(join(tmpdir(), 'ccm project ')) }
    })
    const win = await app.firstWindow()
    await win.emulateMedia({ colorScheme: scheme })
    await win.getByText('Codeburn: running').waitFor({ timeout: 30_000 })
    for (const tab of ['Cost', 'Graph', 'Savings']) {
      await win.getByRole('tab', { name: tab }).click()
      await win.screenshot({ path: `screens/dashboard-${tab.toLowerCase()}-${scheme}.png` })
    }
    await app.close()
  })

  test(`wizard screenshot (${scheme})`, async () => {
    const app = await electron.launch({ args: ['.'], env: { ...baseEnv(), CCM_FORCE_SETUP: '1' } })
    const win = await app.firstWindow()
    await win.emulateMedia({ colorScheme: scheme })
    await win.getByRole('heading', { name: 'Set up ClaudeCodeMax' }).waitFor({ timeout: 60_000 })
    await win.screenshot({ path: `screens/wizard-${scheme}.png` })
    await app.close()
  })
}
```

- [ ] **Step 2: Capture the screens**

Run: `npm run screens`
Expected: 8 PNGs in `screens/`.

- [ ] **Step 3: Set the visual direction**

In Claude Code, run `/design-mastery:style-guide` with this brief:

> Windows 11 developer tool; dense but calm; dark and light themes following the system; one warm accent; Segoe UI Variable plus Cascadia Mono; WCAG AA contrast.

Attach `screens/dashboard-cost-dark.png` and `screens/wizard-light.png`.

Update only the `:root` and dark-mode custom properties plus spacing and radius in `styles.css` to match the guide. Keep every existing class name, so no TSX changes are needed for theming.

- [ ] **Step 4: Accessibility audit**

Run `npm run screens` again, then `/accessibility-compliance:accessibility-audit` on all 8 screenshots and on `src/renderer/src/*.tsx`. Fix every finding at WCAG 2.1 AA level:
- contrast ratios of the tokens in both themes
- focus visibility
- names on controls
- status text not relying on colour alone

Record each fix in the commit message.

- [ ] **Step 5: Final critique pass**

Run `/design-mastery:ui-critique` on the new screenshots. Apply layout, spacing and copy fixes. Reject suggestions that add features, or say so in the commit message.

- [ ] **Step 6: Re-run all checks**

Run: `npm run typecheck && npm test && npm run smoke`
Expected: all PASS. The smoke test depends on the text "Codeburn: running", the tab names, "Build graph" and `.xterm-rows`. If copy changed, keep those strings, or update `test/smoke.spec.ts` in the same commit.

- [ ] **Step 7: Commit**

```bash
git add src/renderer test/screens.spec.ts
git commit -m "style: LibreUIUX visual direction and WCAG AA accessibility fixes"
```

---

### Task 12: Packaging, auto-update, notices, CI release

**Files:**
- Create: `electron-builder.yml`, `.github/workflows/release.yml`, `THIRD_PARTY_NOTICES.md`, `README.md`
- Modify: `src/main/index.ts` (add the updater)

**Interfaces:**
- Consumes: `win` and `app` from `src/main/index.ts`
- Produces: `dist/ClaudeCodeMax-Setup-<version>.exe`, and GitHub Releases on `v*` tags

- [ ] **Step 1: Create `electron-builder.yml`**

```yaml
appId: com.countryboysplay.claudecodemax
productName: ClaudeCodeMax
directories:
  output: dist
files:
  - out/**
  - package.json
asarUnpack:
  - node_modules/@lydell/**
win:
  target: nsis
  artifactName: ClaudeCodeMax-Setup-${version}.${ext}
nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
publish:
  provider: github
  owner: countryboysplay
  repo: ClaudeCodeMax
```

- [ ] **Step 2: Add the updater to `src/main/index.ts`**

Add this import at the top with the other imports:
```ts
import { autoUpdater } from 'electron-updater'
```

Add this function directly above the `if (!app.requestSingleInstanceLock())` line:
```ts
function initUpdater(): void {
  if (!app.isPackaged) return
  autoUpdater.on('update-downloaded', async () => {
    const r = await dialog.showMessageBox(win, {
      type: 'info',
      message: 'A new version of ClaudeCodeMax is ready.',
      buttons: ['Restart to update', 'Later'],
      defaultId: 0,
      cancelId: 1
    })
    if (r.response === 0) autoUpdater.quitAndInstall()
  })
  autoUpdater.checkForUpdates().catch(() => {
    // offline or no releases yet: try again next launch
  })
}
```

In `app.whenReady().then(...)`, add `initUpdater()` as the last line after `createWindow()`.

- [ ] **Step 3: Create `THIRD_PARTY_NOTICES.md`**

```markdown
# Third-party notices

ClaudeCodeMax is MIT licensed. It does not bundle the tools below. The first-run wizard installs each one from its official
source (npm, uv/PyPI, the Claude Code plugin marketplace), and ClaudeCodeMax runs them as separate programs.

| Tool | License | Source |
|---|---|---|
| Claude Code | Anthropic terms | https://claude.com/claude-code |
| Codeburn | MIT | https://github.com/getagentseal/codeburn |
| Headroom | Apache-2.0 | https://github.com/headroomlabs-ai/headroom |
| Graphify | Apache-2.0 | https://github.com/Graphify-Labs/graphify |
| Ponytail | MIT | https://github.com/dietrichgebert/ponytail |

Bundled in the app:

| Package | License |
|---|---|
| Electron | MIT |
| React, React DOM | MIT |
| xterm.js (@xterm/xterm, @xterm/addon-fit) | MIT |
| @lydell/node-pty (fork of microsoft/node-pty) | MIT |
| electron-updater | MIT |

The UI was designed with LibreUIUX-Claude-Code (MIT, https://github.com/HermeticOrmus/LibreUIUX-Claude-Code). None of its files ship in the app.
```

- [ ] **Step 4: Create `README.md`**

````markdown
# ClaudeCodeMax

Claude Code in one Windows 11 window, with:

- **Codeburn**: what your sessions cost
- **Graphify**: a knowledge graph of your project
- **Headroom**: compresses context so you spend fewer tokens
- **Ponytail**: keeps Claude's code minimal

## Install

1. Download `ClaudeCodeMax-Setup-x.y.z.exe` from [Releases](https://github.com/countryboysplay/ClaudeCodeMax/releases).
2. The installer is not code-signed, so Windows SmartScreen shows "Windows protected your PC". Click **More info → Run anyway**.
3. On first launch, the setup wizard installs anything missing: Git, Node.js 22.13+, uv, Claude Code, Codeburn, and optionally Headroom, Graphify and Ponytail.
4. Open a project folder. Claude Code starts in the terminal. Sign in there the first time.

The app updates itself from GitHub Releases. **Tools → Check for tool updates** updates the tools.

## Develop

```bash
npm install
npm run dev        # run with hot reload
npm test           # unit tests
npm run smoke      # end-to-end test with fake tools
npm run dist       # build dist/ClaudeCodeMax-Setup-<version>.exe
```

Release: bump `version` in `package.json`, commit, then `git tag vX.Y.Z && git push --tags`. CI builds and publishes the release.
````

- [ ] **Step 5: Create `.github/workflows/release.yml`**

```yaml
name: release
on:
  push:
    tags: ['v*']
permissions:
  contents: write
jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run smoke
      - run: npm run release
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 6: Build the installer locally**

Run: `npm run dist`
Expected: `dist/ClaudeCodeMax-Setup-0.1.0.exe` exists.

- [ ] **Step 7: Manual install check in Windows Sandbox**

1. Enable Windows Sandbox if it's missing: "Turn Windows features on or off" → Windows Sandbox. It requires Windows 11 Pro/Enterprise. On Windows 11 Home, use a Hyper-V or VirtualBox Windows 11 VM instead.
2. Copy the installer in and run it. Confirm:
   - the SmartScreen "Run anyway" flow works
   - the per-user install needs no admin prompt
   - the wizard installs Git, Node, uv, Claude Code and Codeburn from scratch
   - the dashboard opens
   - after picking a folder, Claude asks you to sign in
   - quitting leaves nothing in Task Manager
3. Write down anything that failed, and fix it before tagging a release.

- [ ] **Step 8: Commit**

```bash
git add electron-builder.yml .github/workflows/release.yml THIRD_PARTY_NOTICES.md README.md src/main/index.ts
git commit -m "build: NSIS installer, GitHub auto-update, notices, README and release workflow"
```

- [ ] **Step 9: Publishing (ask the user first)**

Creating the public GitHub repo and pushing a tag publishes the app. **Stop and ask the user** before running:
```bash
gh repo create countryboysplay/ClaudeCodeMax --public --source . --push
git tag v0.1.0 && git push --tags
```
````
