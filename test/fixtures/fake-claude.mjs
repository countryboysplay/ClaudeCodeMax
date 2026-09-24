import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

if (process.env.CCM_TEST_PIDS) writeFileSync(join(process.env.CCM_TEST_PIDS, `claude-${process.pid}`), '')
console.log('FAKE CLAUDE READY')
console.log(`ANTHROPIC_BASE_URL=${process.env.ANTHROPIC_BASE_URL ?? '(none)'}`)
console.log(`ARGS=${process.argv.slice(2).join(' ')}`)
console.log(`AUTO_MEMORY_OFF=${process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY ?? '0'}`)
process.stdin.on('data', d => process.stdout.write(`echo:${d}`))
setInterval(() => {}, 1 << 30)
