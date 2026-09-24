import { spawn, execFileSync, type ChildProcess } from 'node:child_process'

export interface RunOpts {
  cwd?: string
  env?: NodeJS.ProcessEnv
  input?: string
  timeoutMs?: number
}

export type Runner = (
  command: string,
  onLine?: (line: string) => void,
  opts?: RunOpts
) => Promise<{ code: number; output: string }>

const running = new Set<ChildProcess>()

export const runShell: Runner = (command, onLine, opts = {}) =>
  new Promise(resolve => {
    const child = spawn(command, { shell: true, windowsHide: true, env: opts.env ?? process.env, cwd: opts.cwd })
    running.add(child)
    const timer = opts.timeoutMs ? setTimeout(() => killTree(child.pid), opts.timeoutMs) : undefined
    if (opts.input !== undefined) child.stdin?.end(opts.input)
    let output = ''
    let partial = ''
    const feed = (buf: Buffer) => {
      const text = buf.toString()
      output += text
      const parts = (partial + text).split(/\r?\n/)
      partial = parts.pop() ?? ''
      for (const p of parts) if (p.trim()) onLine?.(p)
    }
    child.stdout?.on('data', feed)
    child.stderr?.on('data', feed)
    const done = (code: number) => {
      clearTimeout(timer)
      running.delete(child)
      if (partial.trim()) onLine?.(partial)
      resolve({ code, output })
    }
    child.on('error', err => done((output += String(err), -1)))
    child.on('close', code => done(code ?? -1))
  })

export function killTree(pid: number | undefined): void {
  if (!pid) return
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  } catch {
    // already exited
  }
}

export function killAll(): void {
  for (const child of running) killTree(child.pid)
}
