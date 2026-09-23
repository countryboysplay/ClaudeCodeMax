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
