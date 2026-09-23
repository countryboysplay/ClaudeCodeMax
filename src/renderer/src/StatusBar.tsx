import type { AppState, Status } from '../../shared/types'

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

export function StatusBar({ state }: { state: AppState }) {
  return (
    <footer className="statusbar" role="status">
      <Item label="Codeburn" status={state.services.codeburn} />
      {state.headroom && <Item label="Headroom" status={state.services.headroom} suffix={` on :${state.ports.headroom}`} />}
      <span className={`item ${state.graphExists ? 'status-up' : ''}`}>
        <span className="dot-mark" aria-hidden="true" />
        Graphify: {state.graphExists ? 'graph ready' : 'no graph yet'}
      </span>
    </footer>
  )
}
