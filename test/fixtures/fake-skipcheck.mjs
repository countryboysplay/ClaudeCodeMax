// Stand-in for the skip classifier (`claude -p`); behaviour is picked with CCM_FAKE_SKIP* env vars.
import { appendFileSync, readFileSync } from 'node:fs'

const prompt = readFileSync(0, 'utf8')
const closer = /<closer>\n([\s\S]*)\n<\/closer>/.exec(prompt)?.[1] ?? ''
if (process.env.CCM_FAKE_SKIP_LOG) appendFileSync(process.env.CCM_FAKE_SKIP_LOG, process.argv.slice(2).join(' ') + '\n')
const mode = process.env.CCM_FAKE_SKIP_MODE
const answer = () => {
  const [skipped, reason] = JSON.parse(process.env.CCM_FAKE_SKIP ?? '{}')[closer] ?? [false, false]
  console.log(JSON.stringify({ skipped, reason_given: reason }))
}
if (mode === 'fail') {
  console.log("You've hit your session limit")
  process.exit(1)
} else if (mode === 'bad') console.log('sure!')
else if (mode === 'hang') setInterval(() => {}, 1 << 30)
else if (mode === 'slow') setTimeout(answer, 200)
else answer()
