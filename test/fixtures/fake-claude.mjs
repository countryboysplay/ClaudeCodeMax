import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

if (process.env.CCM_TEST_PIDS) writeFileSync(join(process.env.CCM_TEST_PIDS, `claude-${process.pid}`), '')
console.log('FAKE CLAUDE READY')
console.log(`ANTHROPIC_BASE_URL=${process.env.ANTHROPIC_BASE_URL ?? '(none)'}`)
console.log(`ARGS=${process.argv.slice(2).join(' ')}`)
console.log(`AUTO_MEMORY_OFF=${process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY ?? '0'}`)
console.log(`USAGE_FILE=${process.env.CCM_USAGE_FILE ?? '(none)'}`)

// Run the status line command from --settings once, as Claude Code does after a response.
const settingsArg = process.argv.indexOf('--settings')
if (settingsArg > 0) {
  const { statusLine } = JSON.parse(readFileSync(process.argv[settingsArg + 1], 'utf8'))
  const now = Math.floor(Date.now() / 1000)
  const input = JSON.stringify({
    model: { display_name: 'Opus' },
    cost: { total_cost_usd: 1.84 },
    context_window: { used_percentage: 31 },
    rate_limits: { five_hour: { used_percentage: 42, resets_at: now + 3600 }, seven_day: { used_percentage: 18, resets_at: now + 86400 } },
    prompt_cache: { warm: true, expires_at: now + 180 },
    session_id: '0e6bcd13-5fed-4526-96cb-5ba76720d8e3'
  })
  console.log(`STATUSLINE=${execSync(statusLine.command, { input }).toString()}`)
}

process.stdin.on('data', d => process.stdout.write(`echo:${d}`))
setInterval(() => {}, 1 << 30)
