// Claude Code status line for ClaudeCodeMax, registered only for sessions the app launches
// (via --settings). It saves Claude Code's session JSON for the app's status bar and prints
// a short line for the terminal. Dependency-free, and it must never fail: errors print nothing.
import { readFileSync, renameSync, writeFileSync } from 'node:fs'

try {
  const text = readFileSync(0, 'utf8')
  const file = process.env.CCM_USAGE_FILE
  if (file) {
    // Write then rename, so the app never reads a half-written file.
    writeFileSync(`${file}.tmp`, text)
    renameSync(`${file}.tmp`, file)
  }
  const d = JSON.parse(text)
  const pct = v => (typeof v === 'number' ? `${Math.round(v)}%` : null)
  const parts = [
    pct(d.rate_limits?.five_hour?.used_percentage) && `5h ${pct(d.rate_limits.five_hour.used_percentage)}`,
    pct(d.context_window?.used_percentage) && `context ${pct(d.context_window.used_percentage)}`
  ].filter(Boolean)
  process.stdout.write(parts.join(' · '))
} catch {
  // never break the session
}
