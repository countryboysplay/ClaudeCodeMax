import { createServer } from 'node:net'

function tryListen(port: number): Promise<number | null> {
  return new Promise(resolve => {
    const srv = createServer()
    srv.once('error', () => resolve(null))
    srv.listen(port, '127.0.0.1', () => {
      const got = (srv.address() as { port: number }).port
      srv.close(() => resolve(got))
    })
  })
}

// ponytail: probes 127.0.0.1 only; a service already bound to ::1 alone on the same port is not detected.
export async function freePort(preferred: number): Promise<number> {
  return (await tryListen(preferred)) ?? (await tryListen(0))!
}
