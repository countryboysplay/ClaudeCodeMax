// Stand-in for `claude -p` in memory runner tests; behaviour is picked with CCM_FAKE_* env vars.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const prompt = readFileSync(0, 'utf8')
const recheck = prompt.startsWith('RECHECK')
if (process.env.CCM_FAKE_LOG) appendFileSync(process.env.CCM_FAKE_LOG, recheck ? 'recheck\n' : 'distill\n')
if (process.env.CCM_FAKE_FAIL) {
  writeFileSync('topics/half-written.md', 'partial') // must be rolled back
  process.exit(1)
}
if (recheck) {
  console.log(process.env.CCM_FAKE_VERDICT ?? 'KEEP')
  process.exit(0)
}
const dir = /(projects\/[^/\s]+)\/topics\//.exec(prompt)[1]
mkdirSync(`${dir}/topics`, { recursive: true })
const secret = process.env.CCM_FAKE_SECRET ? `token ghp_${'a'.repeat(36)}\n` : ''
writeFileSync(
  `${dir}/topics/fake-fact.md`,
  `---\nname: fake-fact\ntype: project\nsummary: a fact the fake distiller learned\nsources: [app.ts]\nverified: 2026-09-24\nused: 2026-09-24\nuses: 0\nstale: false\npinned: false\n---\nThe fake distiller ran.\n${secret}`
)
console.log('added fake-fact')
