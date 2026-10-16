import { useEffect, useState } from 'react'
import type { Task, TaskReport } from '../../shared/types'

function TaskCard({ t }: { t: Task }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="task">
      <div className="task-top">
        <time dateTime={t.when}>{t.when ? new Date(t.when).toLocaleString() : ''}</time>
        {t.unfinished && <span className="badge warn">Unfinished</span>}
        {t.skipFlag && <span className="badge warn">Skipped: check why</span>}
      </div>
      <p className={open ? 'asked' : 'asked clamp'}>{t.asked}</p>
      {t.added.map((a, i) => (
        <p key={i} className="muted">
          You added: {a}
        </p>
      ))}
      {t.files.length > 0 && (
        <p className="files">
          Changed:{' '}
          {t.files.map(f => (
            <button key={f} className="link" title="Show in folder" onClick={() => void window.api.openTaskFile(f)}>
              {f}
            </button>
          ))}
        </p>
      )}
      {t.checklist.length > 0 && (
        <ul className="checklist">
          {t.checklist.map((c, i) => (
            <li key={i}>
              {c.status === 'completed' ? '✓' : '○'} {c.subject} <span className="muted">({c.status})</span>
            </li>
          ))}
        </ul>
      )}
      {t.note && <p className="note">{open ? t.reply : t.note}</p>}
      {(t.reply !== t.note || t.asked.length > 160) && (
        <button className="subtle" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Show less' : 'Show full reply'}
        </button>
      )}
    </li>
  )
}

export function TasksView({ project }: { project: string | null }) {
  const [r, setR] = useState<TaskReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = async () => {
    setBusy(true)
    setError('')
    try {
      setR(await window.api.tasks())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    setR(null)
    if (project) void load()
  }, [project])
  if (!project)
    return (
      <div className="empty">
        <p>Open a project to see its tasks.</p>
      </div>
    )
  if (error)
    return (
      <div className="empty" role="alert">
        <p>Couldn't read this project's sessions: {error}</p>
        <button onClick={() => void load()}>Try again</button>
      </div>
    )
  if (!r)
    return (
      <p className="empty muted" role="status">
        Reading this project's sessions…
      </p>
    )
  const noReason = r.deferred.filter(d => !d.reason).length
  return (
    <div className="tasks">
      <div className="tasks-head">
        <h2>Tasks</h2>
        <button onClick={() => void load()} disabled={busy}>
          {busy ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      <details className="deferred" open={noReason > 0}>
        <summary>
          {r.deferred.length} deferred item{r.deferred.length === 1 ? '' : 's'} in the code
          {noReason > 0 && <span className="badge bad">{noReason} with no reason</span>}
        </summary>
        <ul>
          {r.deferred.map(d => (
            <li key={`${d.file}:${d.line}`}>
              <button className="link" title="Show in folder" onClick={() => void window.api.openTaskFile(d.file)}>
                {d.file}:{d.line}
              </button>{' '}
              {!d.reason && <span className="badge bad">No reason given</span>} <span className="muted">{d.marker}</span> {d.text}
            </li>
          ))}
        </ul>
        {r.scanCapped && <p className="muted">Stopped after 20,000 files.</p>}
      </details>
      {r.tasks.length ? (
        <ol className="task-list">
          {r.tasks.map((t, i) => (
            <TaskCard key={`${t.when}-${i}`} t={t} />
          ))}
        </ol>
      ) : (
        <p className="muted">No Claude sessions found for this project yet.</p>
      )}
      <p className="muted">Files changed through Bash or PowerShell commands aren't listed.</p>
    </div>
  )
}
