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
