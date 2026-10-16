export type Status = 'stopped' | 'starting' | 'up' | 'restarting' | 'failed'
export type ServiceName = 'headroom'

export interface Usage {
  model?: string
  cost?: number
  context?: number
  fiveHour?: { pct: number; resetsAt: number }
  week?: { pct: number; resetsAt: number }
  cacheExpiresAt?: number
}

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
  lean: boolean
  split: number
  tab: string
  services: Record<ServiceName, Status>
  ports: Record<ServiceName, number>
  urls: { savings: string }
  usage: Usage | null
  ptyUsesHeadroom: boolean
  installed: Record<string, boolean>
}

export type InitResult = { mode: 'setup'; steps: StepView[] } | { mode: 'dashboard'; state: AppState }

export interface InstallResult {
  ok: boolean
  error?: string
  steps: StepView[]
}
