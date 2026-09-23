import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { killTree } from './run'
import type { Status } from '../shared/types'

export const BACKOFF = [1000, 3000, 10000]

export interface ServiceSpec {
  name: string
  command: string
  healthUrl: string
}

export interface Child {
  pid?: number
  stdout: NodeJS.EventEmitter | null
  stderr: NodeJS.EventEmitter | null
  on(event: 'exit', listener: () => void): unknown
}

export type Spawner = (command: string) => Child
export type Probe = (url: string) => Promise<boolean>

const defaultSpawner: Spawner = command => spawn(command, { shell: true, windowsHide: true, env: process.env })
const defaultProbe: Probe = url => fetch(url).then(r => r.status < 500, () => false)

// ponytail: attempts reset only on start(); a service that crashes 3 times over a long session stays failed until the user clicks Restart.
export class Service extends EventEmitter {
  status: Status = 'stopped'
  log: string[] = []
  private child?: Child
  private attempts = 0
  private timer?: NodeJS.Timeout
  private wanted = false

  constructor(
    public spec: ServiceSpec,
    private spawner: Spawner = defaultSpawner,
    private probe: Probe = defaultProbe
  ) {
    super()
  }

  start(): void {
    clearTimeout(this.timer)
    this.wanted = true
    this.attempts = 0
    this.launch()
  }

  stop(): void {
    this.wanted = false
    clearTimeout(this.timer)
    const child = this.child
    this.child = undefined
    killTree(child?.pid)
    this.set('stopped')
  }

  restart(): void {
    this.stop()
    this.start()
  }

  private launch(): void {
    this.set('starting')
    const child = this.spawner(this.spec.command)
    this.child = child
    const feed = (b: Buffer) => {
      this.log.push(...b.toString().split(/\r?\n/).filter(Boolean))
      this.log = this.log.slice(-50)
    }
    child.stdout?.on('data', feed)
    child.stderr?.on('data', feed)
    child.on('exit', () => {
      if (this.child === child) this.onExit()
    })
    void this.waitHealthy(child)
  }

  private async waitHealthy(child: Child): Promise<void> {
    for (let i = 0; i < 60 && this.child === child; i++) {
      if (await this.probe(this.spec.healthUrl)) {
        if (this.child === child) this.set('up')
        return
      }
      await new Promise(r => setTimeout(r, 500))
    }
  }

  private onExit(): void {
    this.child = undefined
    if (!this.wanted) return
    const delay = BACKOFF[this.attempts++]
    if (delay === undefined) return this.set('failed')
    this.set('restarting')
    this.timer = setTimeout(() => this.launch(), delay)
  }

  private set(s: Status): void {
    this.status = s
    this.emit('status', s)
  }
}
