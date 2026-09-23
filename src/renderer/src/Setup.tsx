import type { AppState, StepView } from '../../shared/types'

export function Setup({ onDone }: { initial: StepView[]; onDone: (s: AppState) => void }) {
  return (
    <div className="setup">
      <h1>Setup</h1>
      <button className="primary" onClick={async () => onDone(await window.api.setupDone())}>
        Continue
      </button>
    </div>
  )
}

export function UpdateOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="setup">
      <button onClick={onClose}>Close</button>
    </div>
  )
}
