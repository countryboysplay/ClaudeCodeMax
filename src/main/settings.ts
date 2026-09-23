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
