import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

if (process.env.CCM_TEST_PIDS) writeFileSync(join(process.env.CCM_TEST_PIDS, `stub-${process.pid}`), '')
const port = Number(process.argv[2])
createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end(`<h1>STUB ${port}</h1>`)
}).listen(port)
