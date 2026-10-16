import { describe, it, expect } from 'vitest'
import { parseUsage } from '../src/main/usage'

const now = 1_800_000_000
const full = {
  model: { display_name: 'Opus' },
  cost: { total_cost_usd: 1.8432 },
  context_window: { used_percentage: 31.4 },
  rate_limits: {
    five_hour: { used_percentage: 42.2, resets_at: now + 3600 },
    seven_day: { used_percentage: 18, resets_at: now + 86_400 }
  },
  prompt_cache: { warm: true, expires_at: now + 180 }
}

describe('parseUsage', () => {
  it('keeps the fields the status bar shows', () =>
    expect(parseUsage(full, now, true)).toEqual({
      model: 'Opus',
      cost: 1.8432,
      context: 31.4,
      fiveHour: { pct: 42.2, resetsAt: now + 3600 },
      week: { pct: 18, resetsAt: now + 86_400 },
      cacheExpiresAt: now + 180
    }))

  it('drops a limit window whose reset time has passed', () => {
    const r = parseUsage({ rate_limits: { five_hour: { used_percentage: 99, resets_at: now - 1 } } }, now, true)
    expect(r?.fiveHour).toBeUndefined()
  })

  it('keeps only the plan limits when the data is from an earlier session', () =>
    expect(parseUsage(full, now, false)).toEqual({ fiveHour: { pct: 42.2, resetsAt: now + 3600 }, week: { pct: 18, resetsAt: now + 86_400 } }))

  it('treats a cold or expired cache as no cache', () => {
    expect(parseUsage({ prompt_cache: { warm: false, expires_at: now + 60 } }, now, true)?.cacheExpiresAt).toBeUndefined()
    expect(parseUsage({ prompt_cache: { warm: true, expires_at: now - 1 } }, now, true)?.cacheExpiresAt).toBeUndefined()
  })

  it('ignores wrong types instead of showing them', () =>
    expect(parseUsage({ cost: { total_cost_usd: 'lots' }, rate_limits: { five_hour: { used_percentage: '9' } } }, now, true)).toEqual({}))

  it('returns null for anything that is not an object', () => {
    expect(parseUsage(null, now, true)).toBeNull()
    expect(parseUsage([1], now, true)).toBeNull()
  })
})
