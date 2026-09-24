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
  pickProject: (): Promise<void> => ipcRenderer.invoke('project:pick'),
  openProject: (dir: string): Promise<boolean> => ipcRenderer.invoke('project:open', dir),
  ptyWrite: (data: string) => ipcRenderer.send('pty:write', data),
  ptyResize: (cols: number, rows: number) => ipcRenderer.send('pty:resize', cols, rows),
  restartClaude: (): Promise<void> => ipcRenderer.invoke('claude:restart'),
  setHeadroom: (on: boolean): Promise<void> => ipcRenderer.invoke('toggle:headroom', on),
  setPonytail: (on: boolean): Promise<void> => ipcRenderer.invoke('toggle:ponytail', on),
  restartService: (name: string): Promise<void> => ipcRenderer.invoke('service:restart', name),
  serviceLog: (name: string): Promise<string[]> => ipcRenderer.invoke('service:log', name),
  memoryStatus: (): Promise<{ log: string[]; queued: number; commits: string[] }> => ipcRenderer.invoke('memory:status'),
  openMemory: (): Promise<string> => ipcRenderer.invoke('memory:open'),
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
