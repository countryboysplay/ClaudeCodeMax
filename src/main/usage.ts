import type { Usage } from '../shared/types'

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

// Turns the JSON Claude Code hands its status line into what the status bar shows.
// `fresh` is false when the data predates the current Claude session: the plan limits
// still hold then, but cost, context and cache belong to the old session.
export function parseUsage(raw: unknown, nowSec: number, fresh: boolean): Usage | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = obj(raw)
  const limit = (v: unknown) => {
    const pct = num(obj(v).used_percentage)
    const resetsAt = num(obj(v).resets_at)
    return pct !== undefined && resetsAt !== undefined && resetsAt > nowSec ? { pct, resetsAt } : undefined
  }
  const u: Usage = {}
  const rl = obj(o.rate_limits)
  const fiveHour = limit(rl.five_hour)
  const week = limit(rl.seven_day)
  if (fiveHour) u.fiveHour = fiveHour
  if (week) u.week = week
  if (!fresh) return u
  const model = obj(o.model).display_name
  if (typeof model === 'string') u.model = model
  const cost = num(obj(o.cost).total_cost_usd)
  if (cost !== undefined) u.cost = cost
  const context = num(obj(o.context_window).used_percentage)
  if (context !== undefined) u.context = context
  const cache = obj(o.prompt_cache)
  const expires = num(cache.expires_at)
  if (cache.warm === true && expires !== undefined && expires > nowSec) u.cacheExpiresAt = expires
  return u
}
