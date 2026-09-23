import type { AppState, Status } from '../../shared/types'

export const STATUS_TEXT: Record<Status, string> = {
  stopped: 'stopped',
  starting: 'starting',
  up: 'running',
  restarting: 'restarting',
  failed: 'failed'
}

function Item({ label, status }: { label: string; status: Status }) {
  return (
    <span className={`item status-${status}`}>
      <span className="dot-mark" aria-hidden="true" />
      {label}: {STATUS_TEXT[status]}
    </span>
  )
}

export function StatusBar({ state }: { state: AppState }) {
  return (
    <footer className="statusbar">
      <Item label="Codeburn" status={state.services.codeburn} />
      {state.headroom && <Item label={`Headroom proxy :${state.ports.headroom}`} status={state.services.headroom} />}
      <span className="item">Graphify: {state.graphExists ? 'graph ready' : 'no graph yet'}</span>
    </footer>
  )
}
