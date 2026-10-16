import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export interface MemorySettings {
  model: string
  dailyCap: number
  indexCap: number
}

// '' leaves the choice to Claude Code's own settings.
export const MODELS = ['', 'sonnet', 'opusplan', 'opus'] as const
export type Model = (typeof MODELS)[number]

export interface Settings {
  recent: string[]
  headroom: boolean
  ponytail: boolean
  lean: boolean
  model: Model
  skipped: string[]
  split: number
  tab: string
  memory: MemorySettings
}

export const defaults = (): Settings => ({
  recent: [],
  headroom: true,
  ponytail: true,
  lean: true,
  model: '',
  skipped: [],
  split: 0.6,
  tab: 'savings',
  memory: { model: 'claude-haiku-4-5-20251001', dailyCap: 30, indexCap: 60 }
})

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
  if (typeof s.split !== 'number' || !Number.isFinite(s.split) || s.split < 0.2 || s.split > 0.8) s.split = defaults().split
  if (typeof s.headroom !== 'boolean') s.headroom = defaults().headroom
  if (typeof s.ponytail !== 'boolean') s.ponytail = defaults().ponytail
  if (typeof s.lean !== 'boolean') s.lean = defaults().lean
  // Goes into a command line, so only the known values are allowed.
  if (!MODELS.includes(s.model)) s.model = defaults().model
  if (typeof s.tab !== 'string') s.tab = defaults().tab
  const m: Partial<MemorySettings> = s.memory && typeof s.memory === 'object' && !Array.isArray(s.memory) ? s.memory : {}
  const d = defaults().memory
  const int = (v: unknown, lo: number, hi: number, dflt: number) =>
    Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi ? (v as number) : dflt
  s.memory = {
    // The model name goes into a shell command line, so only plain model ids are allowed (no leading '-' flags).
    model: typeof m.model === 'string' && /^\w[\w.:-]*$/.test(m.model) ? m.model : d.model,
    dailyCap: int(m.dailyCap, 0, 1000, d.dailyCap),
    indexCap: int(m.indexCap, 10, 200, d.indexCap)
  }
  return s
}

export function saveSettings(file: string, s: Settings): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(s, null, 2))
}

export function addRecent(list: string[], dir: string): string[] {
  return [dir, ...list.filter(d => d.toLowerCase() !== dir.toLowerCase())].slice(0, 10)
}
