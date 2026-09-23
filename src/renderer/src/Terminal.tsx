import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
const currentTheme = () => ({ background: cssVar('--term-bg'), foreground: cssVar('--term-fg'), cursor: cssVar('--accent') })

export function Terminal({ project }: { project: string | null }) {
  const host = useRef<HTMLDivElement>(null)
  const term = useRef<XTerm>()
  const [ended, setEnded] = useState(false)

  useEffect(() => {
    const t = new XTerm({
      fontFamily: '"Cascadia Mono", Consolas, monospace',
      fontSize: 14,
      cursorBlink: true,
      theme: currentTheme()
    })
    const fit = new FitAddon()
    t.loadAddon(fit)
    t.open(host.current!)
    term.current = t
    t.attachCustomKeyEventHandler(e => {
      if (e.type === 'keydown' && e.ctrlKey && e.shiftKey && e.code === 'KeyC' && t.hasSelection()) {
        void navigator.clipboard.writeText(t.getSelection())
        return false
      }
      return true
    })
    const resize = () => {
      fit.fit()
      window.api.ptyResize(t.cols, t.rows)
    }
    resize()
    t.onData(d => window.api.ptyWrite(d))
    const ro = new ResizeObserver(resize)
    ro.observe(host.current!)
    const offs = [
      window.api.onPtyData(d => {
        setEnded(false)
        t.write(d)
      }),
      window.api.onPtyExit(() => setEnded(true))
    ]
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onThemeChange = () => {
      t.options.theme = currentTheme()
    }
    media.addEventListener('change', onThemeChange)
    return () => {
      offs.forEach(off => off())
      ro.disconnect()
      media.removeEventListener('change', onThemeChange)
      t.dispose()
    }
  }, [])

  useEffect(() => {
    term.current?.reset()
    setEnded(false)
  }, [project])

  return (
    <main className="terminal-area">
      <div ref={host} className="terminal" aria-label="Claude Code terminal" />
      {ended && (
        <div className="overlay" role="alert">
          <p>Session ended</p>
          <button onClick={() => void window.api.restartClaude()}>Restart</button>
        </div>
      )}
      {!project && (
        <div className="overlay">
          <p>Open a project folder to start Claude Code.</p>
          <button className="primary" onClick={() => void window.api.pickProject()}>
            Open folder…
          </button>
        </div>
      )}
    </main>
  )
}
