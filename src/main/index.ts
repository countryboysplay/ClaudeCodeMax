import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
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
let quitting = false

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
  if (quitting) return
  stopClaude()
  if (!project) return pushState()
  const env: Record<string, string> = { ...(process.env as Record<string, string>) }
  ptyUsesHeadroom = settings.headroom && installed.headroom !== false
  if (ptyUsesHeadroom) env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${ports.headroom}`
  try {
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
  if (quitting || !services) return
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
      if (quitting) break
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
    killAll()
  })
  app.on('window-all-closed', () => app.quit())
}
