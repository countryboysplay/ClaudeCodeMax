import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { existsSync, readFileSync, statSync, watchFile, writeFileSync } from 'node:fs'
import { spawn as spawnPty, type IPty } from '@lydell/node-pty'
import { refreshPath } from './path'
import { runShell, killTree, killAll } from './run'
import { freePort } from './ports'
import { loadSettings, saveSettings, addRecent, MODELS, type Model, type Settings } from './settings'
import { guardWebviews } from './guard'
import { Service } from './services'
import { STEPS, check, install, blockedBy, needsWizard } from './setup'
import { MemoryRunner } from './memory/runner'
import { claudeProjectsDir, memDir } from './memory/files'
import { git, readQueue } from './memory/store'
import { parseUsage } from './usage'
import { leanSettings, readLeanInputs } from './lean'
import { readTasks } from './tasks'
import { scanDeferred } from './deferred'
import { isInside } from './security'
import type { AppState, InitResult, InstallResult, ServiceName, StepView, TaskReport, Usage } from '../shared/types'

const REPO_URL = 'https://github.com/countryboysplay/ClaudeCodeMax'
const UPDATE_CMDS = [
  'uv tool upgrade headroom-ai',
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
let memory: MemoryRunner | null = null
const ports: Record<ServiceName, number> = { headroom: 8787 }
let quitting = false
let usage: Usage | null = null
let sessionStart = 0

const override = (name: string, fallback: string) => process.env[`CCM_CMD_${name}`] ?? fallback
const save = () => saveSettings(settingsFile(), settings)
const send = (channel: string, ...args: unknown[]) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
}
const usageFile = () => join(app.getPath('userData'), 'usage.json')

const resource = (name: string) =>
  (app.isPackaged ? join(process.resourcesPath, name) : join(app.getAppPath(), 'resources', name)).replace(/\\/g, '/')

// Memory hooks, the usage status line and Lean mode for app-launched sessions only: passed with --settings, so ~/.claude/settings.json is never touched.
function writeHooks(): string {
  const hook = (event: string) => [{ hooks: [{ type: 'command', command: `node "${resource('memory-hook.mjs')}" ${event}` }] }]
  const file = join(app.getPath('userData'), 'ccm-hooks.json')
  writeFileSync(
    file,
    JSON.stringify(
      {
        hooks: { SessionStart: hook('start'), SessionEnd: hook('enqueue'), PreCompact: hook('enqueue') },
        statusLine: { type: 'command', command: `node "${resource('statusline.mjs')}"` },
        ...(settings.lean ? leanSettings(readLeanInputs(join(homedir(), '.claude'), project)) : {})
      },
      null,
      2
    )
  )
  return file
}

// Re-reads the file the status line script writes. Only data written since this Claude
// session started counts as the session's own; older data still carries the plan limits.
function readUsage(): void {
  try {
    const f = usageFile()
    usage = parseUsage(JSON.parse(readFileSync(f, 'utf8')), Date.now() / 1000, statSync(f).mtimeMs >= sessionStart)
  } catch {
    usage = null // no session has reported yet
  }
}

function state(): AppState {
  return {
    project,
    recent: settings.recent,
    headroom: settings.headroom,
    ponytail: settings.ponytail,
    lean: settings.lean,
    model: settings.model,
    split: settings.split,
    tab: settings.tab,
    services: { headroom: services?.headroom.status ?? 'stopped' },
    ports: { ...ports },
    urls: { savings: `http://127.0.0.1:${ports.headroom}/dashboard` },
    usage,
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

// `resume` reopens the conversation that was running, so a toggle doesn't throw it away.
function launchClaude(resume = false): void {
  if (quitting) return
  stopClaude()
  if (!project) return pushState()
  const env: Record<string, string> = { ...(process.env as Record<string, string>) }
  ptyUsesHeadroom = settings.headroom && installed.headroom !== false
  if (ptyUsesHeadroom) env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${ports.headroom}`
  env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1'
  env.CCM_MEMORY_DIR = memDir()
  env.CCM_USAGE_FILE = usageFile()
  sessionStart = Date.now()
  readUsage()
  try {
    // A string is passed to cmd.exe verbatim; /s keeps the inner quotes intact when paths contain spaces.
    const p = spawnPty(process.env.ComSpec ?? 'cmd.exe', `/s /c ""${override('CLAUDE', 'claude')}" --settings "${writeHooks()}"${settings.model ? ` --model ${settings.model}` : ''}${resume ? ' --continue' : ''}"`, {
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
  } catch (err) {
    pty = null
    send('pty:data', `\r\nFailed to start Claude Code: ${err instanceof Error ? err.message : String(err)}\r\n`)
    send('pty:exit')
  }
  pushState()
}

function openProject(dir: string): boolean {
  if (!existsSync(dir)) {
    settings.recent = settings.recent.filter(d => d !== dir)
    save()
    pushState()
    return false
  }
  project = dir
  settings.recent = addRecent(settings.recent, dir)
  save()
  launchClaude()
  return true
}

async function pickProject(): Promise<void> {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
  if (!r.canceled && r.filePaths[0]) openProject(r.filePaths[0])
}

// ---- Services -------------------------------------------------------------

function syncServices(): void {
  if (quitting || !services) return
  if (settings.headroom && installed.headroom !== false && services.headroom.status === 'stopped') services.headroom.start()
}

let started = false
async function startDashboard(): Promise<void> {
  if (started) return
  started = true
  ports.headroom = await freePort(8787)
  const cmdFor = (name: ServiceName, fallback: string) => override(name.toUpperCase(), fallback).replace('{port}', String(ports[name]))
  services = {
    headroom: new Service({
      name: 'headroom',
      command: cmdFor('headroom', 'headroom proxy --port {port}'),
      healthUrl: `http://127.0.0.1:${ports.headroom}/stats`,
      // Headroom sends an anonymous usage beacon and checks PyPI daily unless told not to.
      env: { HEADROOM_BEACON: 'off', HEADROOM_UPDATE_CHECK: 'off' }
    })
  }
  for (const s of Object.values(services)) s.on('status', pushState)
  syncServices()
  watchFile(usageFile(), { interval: 1000 }, () => {
    readUsage()
    pushState()
  })
  memory = new MemoryRunner({ root: memDir(), claudeProjects: claudeProjectsDir(), command: override('DISTILLER', 'claude'), ...settings.memory })
  void memory.init()
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
  const svc = (n: unknown) => (services && n === 'headroom' ? services[n] : null)

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
    launchClaude(!!pty)
  })
  ipcMain.handle('toggle:lean', (_e, on: unknown) => {
    settings.lean = on === true
    save()
    launchClaude(!!pty)
  })
  ipcMain.handle('model:set', (_e, m: unknown) => {
    if (!MODELS.includes(m as Model)) return
    settings.model = m as Model
    save()
    // Switch the running session in place: a restart would lose the conversation.
    if (settings.model) pty?.write(`/model ${settings.model}\r`)
    pushState()
  })
  ipcMain.handle('toggle:ponytail', async (_e, on: unknown) => {
    const previous = settings.ponytail
    settings.ponytail = on === true
    save()
    const r = await runShell(`claude plugin ${settings.ponytail ? 'enable' : 'disable'} ponytail@ponytail`)
    if (r.code !== 0) {
      settings.ponytail = previous
      save()
      pushState()
      return
    }
    launchClaude(!!pty)
  })
  ipcMain.handle('service:restart', (_e, n: unknown) => svc(n)?.restart())
  ipcMain.handle('memory:status', async () => ({
    log: memory?.log ?? [],
    queued: readQueue(memDir()).length,
    commits: (await git(memDir(), 'log', '-15', '--format=%cr — %s').catch(() => '')).split('\n').filter(Boolean)
  }))
  ipcMain.handle('memory:open', () => shell.openPath(memDir()))
  ipcMain.handle('tasks:get', async (): Promise<TaskReport | null> => {
    if (!project) return null
    const [tasks, scan] = await Promise.all([readTasks(project, claudeProjectsDir(), join(homedir(), '.claude', 'tasks')), scanDeferred(project)])
    return { tasks, ...scan }
  })
  ipcMain.handle('tasks:open', (_e, file: unknown) => {
    // Only files inside the open project: the path comes from transcripts and source comments.
    if (project && typeof file === 'string' && isInside(project, file)) void shell.openPath(resolve(project, file))
  })
  ipcMain.handle('service:log', (_e, n: unknown) => (n === 'memory' ? (memory?.log ?? []) : (svc(n)?.log ?? [])))
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
    const resume = !!pty
    stopClaude()
    services?.headroom.stop()
    for (const c of UPDATE_CMDS) {
      if (quitting) break
      send('setup:log', `> ${c}`)
      const r = await runShell(c, l => send('setup:log', l))
      if (r.code !== 0) send('setup:log', `(exit ${r.code}, continuing)`)
    }
    refreshPath()
    await checkAll()
    syncServices()
    launchClaude(resume)
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
  guardWebviews(win)
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

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
    initUpdater()
  })
  app.on('before-quit', () => {
    quitting = true
    stopClaude()
    if (services) for (const s of Object.values(services)) s.stop()
    memory?.stop()
    killAll()
  })
  app.on('window-all-closed', () => app.quit())
}
