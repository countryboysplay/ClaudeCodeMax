import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

if (process.env.CCM_TEST_PIDS) writeFileSync(join(process.env.CCM_TEST_PIDS, `claude-${process.pid}`), '')
console.log('FAKE CLAUDE READY')
console.log(`ANTHROPIC_BASE_URL=${process.env.ANTHROPIC_BASE_URL ?? '(none)'}`)
process.stdin.on('data', d => process.stdout.write(`echo:${d}`))
setInterval(() => {}, 1 << 30)
