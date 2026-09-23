import { useEffect, useState, type KeyboardEvent } from 'react'
import type { AppState, Status } from '../../shared/types'
import { STATUS_TEXT } from './StatusBar'

const TABS = [
  { id: 'cost', label: 'Cost' },
  { id: 'graph', label: 'Graph' },
  { id: 'savings', label: 'Savings' }
]

function Missing({ tool, onSetup }: { tool: string; onSetup: () => void }) {
  return (
    <div className="empty muted">
      <p>{tool} isn't installed.</p>
      <button onClick={onSetup}>Install {tool}</button>
    </div>
  )
}

function ServiceView({ name, label, status, url }: { name: string; label: string; status: Status; url: string }) {
  const [log, setLog] = useState<string[]>([])
  useEffect(() => {
    if (status === 'failed') void window.api.serviceLog(name).then(setLog)
  }, [status, name])
  if (status === 'up') return <webview src={url} />
  if (status === 'failed')
    return (
      <div className="empty" role="alert">
        <p>{label} stopped after 3 restart attempts.</p>
        <button onClick={() => void window.api.restartService(name)}>Restart {label}</button>
        <pre className="log">{log.join('\n') || 'No output captured.'}</pre>
      </div>
    )
  return (
    <div className="empty" role="status">
      <p>
        {label} is {STATUS_TEXT[status]}…
      </p>
    </div>
  )
}

export function Panels({ state, onSetup }: { state: AppState; onSetup: () => void }) {
  const [tab, setTab] = useState(TABS.some(t => t.id === state.tab) ? state.tab : 'cost')
  const [graphVersion, setGraphVersion] = useState(0)
  useEffect(() => window.api.onGraphChanged(() => setGraphVersion(v => v + 1)), [])

  const select = (id: string) => {
    setTab(id)
    void window.api.setLayout({ tab: id })
  }
  const onKey = (e: KeyboardEvent) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!d) return
    const i = TABS.findIndex(t => t.id === tab)
    const next = TABS[(i + d + TABS.length) % TABS.length].id
    select(next)
    document.getElementById(`tab-${next}`)?.focus()
  }

  function body() {
    if (tab === 'cost') {
      if (state.installed.codeburn === false) return <Missing tool="Codeburn" onSetup={onSetup} />
      return <ServiceView name="codeburn" label="Codeburn" status={state.services.codeburn} url={state.urls.cost} />
    }
    if (tab === 'savings') {
      if (state.installed.headroom === false) return <Missing tool="Headroom" onSetup={onSetup} />
      if (!state.headroom)
        return (
          <div className="empty">
            <p>Headroom is off.</p>
            <button onClick={() => void window.api.setHeadroom(true)}>Turn on Headroom</button>
          </div>
        )
      return <ServiceView name="headroom" label="Headroom" status={state.services.headroom} url={state.urls.savings} />
    }
    if (state.installed.graphify === false) return <Missing tool="Graphify" onSetup={onSetup} />
    if (!state.project)
      return (
        <div className="empty">
          <p>Open a project to see its knowledge graph.</p>
        </div>
      )
    if (!state.graphExists)
      return (
        <div className="empty">
          <p>No graph for this project yet.</p>
          <button className="primary" onClick={() => window.api.ptyWrite('/graphify .\r')}>
            Build graph
          </button>
        </div>
      )
    return <webview key={graphVersion} src={state.urls.graph!} />
  }

  return (
    <section className="panels" aria-label="Tool panels">
      <div role="tablist" className="tabs" aria-label="Tools">
        {TABS.map(t => (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            role="tab"
            aria-selected={tab === t.id}
            aria-controls="tabpanel"
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => select(t.id)}
            onKeyDown={onKey}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id="tabpanel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="panel-body">
        {body()}
      </div>
    </section>
  )
}
