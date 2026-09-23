import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { Service, type Child } from '../src/main/services'

type Fake = EventEmitter & Child

function fakeChild(): Fake {
  const c = new EventEmitter() as Fake
  c.stdout = new EventEmitter()
  c.stderr = new EventEmitter()
  return c
}

function make(probe: (url: string) => Promise<boolean> = async () => true) {
  const children: Fake[] = []
  const svc = new Service(
    { name: 'x', command: 'x', healthUrl: 'http://x' },
    () => {
      const c = fakeChild()
      children.push(c)
      return c
    },
    probe
  )
  return { svc, children }
}

describe('Service', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('goes up when the health probe passes', async () => {
    const { svc } = make()
    svc.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(svc.status).toBe('up')
  })

  it('stays starting while the probe fails', async () => {
    const { svc } = make(async () => false)
    svc.start()
    await vi.advanceTimersByTimeAsync(2000)
    expect(svc.status).toBe('starting')
  })

  it('keeps probing past 60 attempts until healthy (no attempt cap)', async () => {
    let calls = 0
    const { svc } = make(async () => {
      calls++
      return calls > 70
    })
    svc.start()
    await vi.advanceTimersByTimeAsync(71 * 500)
    expect(svc.status).toBe('up')
  })

  it('restarts with 1s, 3s, 10s backoff, then gives up', async () => {
    const { svc, children } = make()
    svc.start()
    await vi.advanceTimersByTimeAsync(0)
    let expected = 1
    for (const delay of [1000, 3000, 10000]) {
      children.at(-1)!.emit('exit')
      expect(svc.status).toBe('restarting')
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(children).toHaveLength(expected)
      await vi.advanceTimersByTimeAsync(1)
      expect(children).toHaveLength(++expected)
    }
    children.at(-1)!.emit('exit')
    expect(svc.status).toBe('failed')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(children).toHaveLength(4)
  })

  it('stop during backoff cancels the pending restart', async () => {
    const { svc, children } = make()
    svc.start()
    await vi.advanceTimersByTimeAsync(0)
    children[0].emit('exit')
    svc.stop()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(children).toHaveLength(1)
    expect(svc.status).toBe('stopped')
  })

  it('an exit after stop does not restart', async () => {
    const { svc, children } = make()
    svc.start()
    svc.stop()
    children[0].emit('exit')
    await vi.advanceTimersByTimeAsync(20_000)
    expect(children).toHaveLength(1)
    expect(svc.status).toBe('stopped')
  })

  it('start after failure resets the attempt count', async () => {
    const { svc, children } = make()
    svc.start()
    for (let i = 0; i < 4; i++) {
      children.at(-1)!.emit('exit')
      await vi.advanceTimersByTimeAsync(10_000)
    }
    expect(svc.status).toBe('failed')
    svc.start()
    children.at(-1)!.emit('exit')
    expect(svc.status).toBe('restarting')
  })

  it('keeps only the last 50 log lines', () => {
    const { svc, children } = make()
    svc.start()
    const text = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join('\n')
    ;(children[0].stdout as EventEmitter).emit('data', Buffer.from(text))
    expect(svc.log).toHaveLength(50)
    expect(svc.log[0]).toBe('line 11')
  })

  it('emits status events', async () => {
    const { svc } = make()
    const seen: string[] = []
    svc.on('status', s => seen.push(s))
    svc.start()
    await vi.advanceTimersByTimeAsync(0)
    svc.stop()
    expect(seen).toEqual(['starting', 'up', 'stopped'])
  })
})
