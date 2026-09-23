import { spawn, execFileSync, type ChildProcess } from 'node:child_process'

export type Runner = (command: string, onLine?: (line: string) => void) => Promise<{ code: number; output: string }>

const running = new Set<ChildProcess>()

export const runShell: Runner = (command, onLine) =>
  new Promise(resolve => {
    const child = spawn(command, { shell: true, windowsHide: true, env: process.env })
    running.add(child)
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
