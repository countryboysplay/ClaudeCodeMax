import { useEffect, useRef, useState } from 'react'
import type { AppState, StepView } from '../../shared/types'

function useLog(): string[] {
  const [lines, setLines] = useState<string[]>([])
  useEffect(() => window.api.onSetupLog(l => setLines(x => [...x.slice(-500), l])), [])
  return lines
}

function LogPane({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLPreElement>(null)
  useEffect(() => {
    ref.current?.scrollTo(0, ref.current.scrollHeight)
  }, [lines])
  return (
    <pre ref={ref} className="log" role="log" aria-label="Install log">
      {lines.length ? lines.join('\n') : <span className="muted">No output yet.</span>}
    </pre>
  )
}

const statusText = (s: StepView) => (s.ok ? 'Installed' : s.skipped ? 'Skipped' : s.blockedBy ? `Needs ${s.blockedBy}` : 'Not installed')
const stepClass = (s: StepView, failed: boolean) => (failed ? 'failed' : s.ok ? 'ok' : s.skipped ? 'skipped' : 'missing')

export function Setup({ initial, onDone }: { initial: StepView[]; onDone: (s: AppState) => void }) {
  const [steps, setSteps] = useState(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const log = useLog()
  const titleRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => titleRef.current?.focus(), [])

  async function installOne(id: string): Promise<StepView[]> {
    setBusy(id)
    const r = await window.api.setupInstall(id)
    setBusy(null)
    setSteps(r.steps)
    setErrors(e => ({ ...e, [id]: r.ok ? '' : (r.error ?? 'Install failed') }))
    // The Install/Retry button that had focus can disappear once the row updates; land focus
    // on the row's status so keyboard and screen-reader users don't lose their place.
    document.getElementById(`status-${id}`)?.focus()
    return r.steps
  }

  async function installAll() {
    let current = steps
    for (const { id } of steps) {
      const s = current.find(x => x.id === id)!
      if (s.ok || s.skipped || s.blockedBy) continue
      current = await installOne(id)
    }
  }

  async function skip(id: string) {
    setSteps(await window.api.setupSkip(id))
  }

  async function finish() {
    for (const s of steps) if (!s.ok && !s.required && !s.skipped) await window.api.setupSkip(s.id)
    onDone(await window.api.setupDone())
  }

  const ready = steps.every(s => s.ok || !s.required)
  const toInstall = steps.filter(s => !s.ok && !s.skipped && !s.blockedBy)
  const missingRequired = steps.filter(s => s.required && !s.ok).map(s => s.label)
  const requiredSteps = steps.filter(s => s.required)
  const optionalSteps = steps.filter(s => !s.required)

  const row = (s: StepView) => (
    <li key={s.id} className={`step ${stepClass(s, !!errors[s.id])}`}>
      <span className={s.required ? 'step-label required' : 'step-label'}>
        {s.label}
        {!s.required && <span className="muted"> (optional)</span>}
      </span>
      <span id={`status-${s.id}`} className="step-status" tabIndex={-1} aria-live="polite" aria-describedby={errors[s.id] ? `error-${s.id}` : undefined}>
        {busy === s.id ? 'Installing…' : errors[s.id] ? 'Failed' : statusText(s)}
      </span>
      <span className="step-actions">
        {!s.ok && busy !== s.id && !s.blockedBy && (
          <button disabled={!!busy} aria-label={`${errors[s.id] ? 'Retry' : 'Install'} ${s.label}`} onClick={() => void installOne(s.id)}>
            {errors[s.id] ? 'Retry' : 'Install'}
          </button>
        )}
        {!s.ok && !s.required && !s.skipped && (
          <button disabled={!!busy} aria-label={`Skip ${s.label}`} onClick={() => void skip(s.id)}>
            Skip
          </button>
        )}
      </span>
      {errors[s.id] && (
        <pre id={`error-${s.id}`} className="step-error">
          {errors[s.id]}
        </pre>
      )}
    </li>
  )

  return (
    <div className="setup" role="dialog" aria-modal="true" aria-labelledby="setup-title">
      <h1 id="setup-title" ref={titleRef} tabIndex={-1}>Set up ClaudeCodeMax</h1>
      <p>
        ClaudeCodeMax runs Claude Code together with Codeburn, Headroom, Graphify and Ponytail. Required tools must be installed. Optional
        ones can be skipped and installed later from Tools → Re-run setup.
      </p>
      {requiredSteps.length > 0 && (
        <>
          <h2 className="steps-heading">Required</h2>
          <ul className="steps">{requiredSteps.map(row)}</ul>
        </>
      )}
      {optionalSteps.length > 0 && (
        <>
          <h2 className="steps-heading">Optional</h2>
          <ul className="steps">{optionalSteps.map(row)}</ul>
        </>
      )}
      <div className="actions">
        {!ready && (
          <span id="continue-hint" className="muted hint">
            Install {new Intl.ListFormat('en').format(missingRequired)} to continue
          </span>
        )}
        <button className={ready ? '' : 'primary'} disabled={!!busy || !toInstall.length} onClick={() => void installAll()}>
          {toInstall.length ? `Install ${toInstall.length} missing tool${toInstall.length === 1 ? '' : 's'}` : 'Install everything missing'}
        </button>
        <button
          className={ready ? 'primary' : ''}
          disabled={!!busy || !ready}
          aria-describedby={ready ? undefined : 'continue-hint'}
          onClick={() => void finish()}
        >
          Continue
        </button>
      </div>
      <p className="muted">
        After setup, open a project folder. Claude Code starts in the terminal. Sign in there the first time.
      </p>
      <LogPane lines={log} />
    </div>
  )
}

export function UpdateOverlay({ onClose }: { onClose: () => void }) {
  const log = useLog()
  const [done, setDone] = useState(false)
  const titleRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => titleRef.current?.focus(), [])
  useEffect(() => {
    void window.api.updateTools().then(() => setDone(true))
  }, [])
  return (
    <div className="setup" role="dialog" aria-modal="true" aria-labelledby="update-title">
      <h1 id="update-title" ref={titleRef} tabIndex={-1}>Updating tools</h1>
      <p>Claude Code and the background services stop during the update and restart when it finishes.</p>
      <LogPane lines={log} />
      <div className="actions">
        <button className="primary" disabled={!done} onClick={onClose}>
          {done ? 'Close' : 'Updating…'}
        </button>
      </div>
    </div>
  )
}
