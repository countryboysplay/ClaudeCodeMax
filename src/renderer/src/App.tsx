import { useEffect, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { AppState, StepView } from '../../shared/types'
import { Terminal } from './Terminal'
import { Panels } from './Panels'
import { StatusBar } from './StatusBar'
import { Setup, UpdateOverlay } from './Setup'

function Toggle(props: { label: string; on: boolean; available: boolean; onChange: (v: boolean) => void; onInstall: () => void }) {
  if (!props.available)
    return (
      <button className="toggle off" onClick={props.onInstall}>
        {props.label}: not installed — Install
      </button>
    )
  return (
    <button className={`toggle ${props.on ? 'on' : 'off'}`} aria-pressed={props.on} onClick={() => props.onChange(!props.on)}>
      <span className="dot-mark" aria-hidden="true" />
      {props.label} {props.on ? 'on' : 'off'}
    </button>
  )
}

function Header({ state, onSetup }: { state: AppState; onSetup: () => void }) {
  const choose = (v: string) => void (v === '__pick' ? window.api.pickProject() : window.api.openProject(v))
  return (
    <header className="header">
      <label>
        Project
        <select value={state.project ?? ''} onChange={e => choose(e.target.value)}>
          {!state.project && <option value="">No project</option>}
          {state.recent.map(d => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
          <option value="__pick">Open folder…</option>
        </select>
      </label>
      <Toggle
        label="Headroom"
        on={state.headroom}
        available={state.installed.headroom !== false}
        onChange={v => void window.api.setHeadroom(v)}
        onInstall={onSetup}
      />
      <Toggle
        label="Ponytail"
        on={state.ponytail}
        available={state.installed.ponytail !== false}
        onChange={v => void window.api.setPonytail(v)}
        onInstall={onSetup}
      />
      {state.ponytail && state.installed.ponytail !== false && state.project && (
        <>
          <button onClick={() => window.api.ptyWrite('/ponytail-review\r')}>Ponytail review</button>
          <button onClick={() => window.api.ptyWrite('/ponytail-audit\r')}>Ponytail audit</button>
        </>
      )}
    </header>
  )
}

function Divider({ split, onChange }: { split: number; onChange: (v: number) => void }) {
  const commit = (v: number) => {
    const c = Math.min(0.8, Math.max(0.2, v))
    onChange(c)
    return c
  }
  const drag = (e: ReactPointerEvent) => {
    e.preventDefault()
    document.body.classList.add('dragging')
    const move = (ev: PointerEvent) => commit(ev.clientX / window.innerWidth)
    const up = (ev: PointerEvent) => {
      document.body.classList.remove('dragging')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      void window.api.setLayout({ split: commit(ev.clientX / window.innerWidth) })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const key = (e: KeyboardEvent) => {
    const d = e.key === 'ArrowLeft' ? -0.05 : e.key === 'ArrowRight' ? 0.05 : 0
    if (d) void window.api.setLayout({ split: commit(split + d) })
  }
  return (
    <div
      className="divider"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize terminal and panels"
      aria-valuenow={Math.round(split * 100)}
      aria-valuemin={20}
      aria-valuemax={80}
      tabIndex={0}
      onPointerDown={drag}
      onKeyDown={key}
    />
  )
}

function Dashboard({ state, onSetup }: { state: AppState; onSetup: () => void }) {
  const [split, setSplit] = useState(state.split)
  const headroomDown = state.ptyUsesHeadroom && ['restarting', 'failed', 'stopped'].includes(state.services.headroom)
  return (
    <div className="app" style={{ gridTemplateColumns: `${split * 100}% 6px 1fr` }}>
      <Header state={state} onSetup={onSetup} />
      {headroomDown && (
        <div className="banner" role="alert">
          <span>Headroom proxy is down, so Claude can't reach the API.</span>
          <button onClick={() => void window.api.restartService('headroom')}>Restart Headroom</button>
          <button onClick={() => void window.api.setHeadroom(false)}>Relaunch Claude without Headroom</button>
        </div>
      )}
      <Terminal project={state.project} />
      <Divider split={split} onChange={setSplit} />
      <Panels state={state} onSetup={onSetup} />
      <StatusBar state={state} />
    </div>
  )
}

export function App() {
  const [mode, setMode] = useState<'loading' | 'setup' | 'dashboard'>('loading')
  const [steps, setSteps] = useState<StepView[]>([])
  const [state, setState] = useState<AppState | null>(null)
  const [updating, setUpdating] = useState(false)

  const openSetup = async () => {
    setSteps(await window.api.setupCheck())
    setMode('setup')
  }

  useEffect(() => {
    void window.api.init().then(r => {
      if (r.mode === 'setup') {
        setSteps(r.steps)
        setMode('setup')
      } else {
        setState(r.state)
        setMode('dashboard')
      }
    })
    const offs = [
      window.api.onState(setState),
      window.api.onMenu(item => {
        if (item === 'setup') void openSetup()
        if (item === 'update') setUpdating(true)
      })
    ]
    return () => offs.forEach(off => off())
  }, [])

  if (mode === 'loading')
    return (
      <p className="center" role="status">
        Checking your tools…
      </p>
    )
  return (
    <>
      {state && <Dashboard state={state} onSetup={() => void openSetup()} />}
      {mode === 'setup' && (
        <Setup
          initial={steps}
          onDone={s => {
            setState(s)
            setMode('dashboard')
          }}
        />
      )}
      {updating && <UpdateOverlay onClose={() => setUpdating(false)} />}
    </>
  )
}
