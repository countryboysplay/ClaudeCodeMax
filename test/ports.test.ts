import { describe, it, expect } from 'vitest'
import { createServer } from 'node:net'
import { freePort } from '../src/main/ports'

describe('freePort', () => {
  it('returns the preferred port when it is free', async () => {
    const free = await freePort(0)
    expect(await freePort(free)).toBe(free)
  })
  it('returns a different port when the preferred one is taken', async () => {
    const srv = createServer().listen(0, '127.0.0.1')
    await new Promise(r => srv.once('listening', r))
    const taken = (srv.address() as { port: number }).port
    const got = await freePort(taken)
    srv.close()
    expect(got).not.toBe(taken)
    expect(got).toBeGreaterThan(0)
  })
})
