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
