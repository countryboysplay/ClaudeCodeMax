import { useEffect, useState } from 'react'
import type { AppState, Status, Usage } from '../../shared/types'

export const STATUS_TEXT: Record<Status, string> = {
  stopped: 'stopped',
  starting: 'starting',
  up: 'running',
  restarting: 'restarting',
  failed: 'failed'
}

function Item({ label, status, suffix }: { label: string; status: Status; suffix?: string }) {
  return (
    <span className={`item status-${status}`}>
      <span className="dot-mark" aria-hidden="true" />
      {label}: {STATUS_TEXT[status]}
      {suffix}
    </span>
  )
}

const level = (pct: number) => (pct >= 95 ? 'level-bad' : pct >= 80 ? 'level-warn' : 'level-ok')
const time = (sec: number) => new Date(sec * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const day = (sec: number) => new Date(sec * 1000).toLocaleDateString([], { weekday: 'short' })

function Meter({ label, pct, title }: { label: string; pct: number; title: string }) {
  return (
    <span className={`item ${level(pct)}`} title={title}>
      <span className="dot-mark" aria-hidden="true" />
      {label}: {Math.round(pct)}%
    </span>
  )
}

function UsageItems({ u }: { u: Usage | null }) {
  // Re-render every 15s so the cache countdown stays current between Claude responses.
  const [now, setNow] = useState(Date.now() / 1000)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 15_000)
    return () => clearInterval(id)
  }, [])
  if (!u?.fiveHour && !u?.week && u?.context === undefined)
    return <span className="usage muted">Usage: shows after Claude's first reply</span>
  const cacheMin = u.cacheExpiresAt && u.cacheExpiresAt > now ? Math.ceil((u.cacheExpiresAt - now) / 60) : 0
  return (
    // aria-live off: these numbers change on every response and would flood a screen reader.
    <span className="usage" aria-live="off">
      {u.fiveHour && <Meter label="5h" pct={u.fiveHour.pct} title={`5-hour limit, resets at ${time(u.fiveHour.resetsAt)}`} />}
      {u.fiveHour && <span className="muted">resets {time(u.fiveHour.resetsAt)}</span>}
      {u.week && <Meter label="Week" pct={u.week.pct} title={`Weekly limit, resets ${day(u.week.resetsAt)} ${time(u.week.resetsAt)}`} />}
      {u.context !== undefined && <Meter label="Context" pct={u.context} title="How full this session's context window is" />}
      {u.context !== undefined && u.context >= 60 && (
        <>
          <button title="Summarize the conversation so far into a shorter one (/compact)" onClick={() => window.api.ptyWrite('/compact\r')}>
            Compact
          </button>
          <button
            title="Start a fresh conversation (/clear)"
            onClick={() => window.confirm('Clear the conversation and start fresh?') && window.api.ptyWrite('/clear\r')}
          >
            Clear
          </button>
        </>
      )}
      {u.cost !== undefined && (
        <span className="item" title="This session at API list prices. On a Max plan you pay the plan price, not this.">
          Session: ${u.cost.toFixed(2)}
        </span>
      )}
      {u.context !== undefined && (
        <span
          className={`item ${cacheMin && cacheMin <= 5 ? 'level-warn' : ''}`}
          title="While the cache is warm, earlier context costs about a tenth. After it goes cold, the next message re-sends everything at full price."
        >
          Cache: {!cacheMin ? 'cold' : cacheMin <= 5 ? `cold in ${cacheMin}m` : `warm ${cacheMin}m`}
        </span>
      )}
      {u.model && <span className="item muted">{u.model}</span>}
    </span>
  )
}

export function StatusBar({ state }: { state: AppState }) {
  return (
    <footer className="statusbar" role="status">
      <UsageItems u={state.usage} />
      {state.headroom && <Item label="Headroom" status={state.services.headroom} suffix={` on :${state.ports.headroom}`} />}
    </footer>
  )
}
