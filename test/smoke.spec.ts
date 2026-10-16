import { test, expect, _electron as electron } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const fixtures = resolve('test/fixtures')
const SESSION = '0e6bcd13-5fed-4526-96cb-5ba76720d8e3' // fake-claude's status line session_id
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test('runs Claude in the project, serves the Savings panel, reports usage, and leaves no orphans', async () => {
  const pids = mkdtempSync(join(tmpdir(), 'ccm-pids-'))
  const project = mkdtempSync(join(tmpdir(), 'ccm project ')) // space on purpose
  const stub = `node "${join(fixtures, 'stub-server.mjs')}" {port}`
  const memory = join(mkdtempSync(join(tmpdir(), 'ccm-mem-')), 'memory')
  // A past session and a deferred comment with no reason, for the Tasks tab.
  const cp = mkdtempSync(join(tmpdir(), 'ccm-cp-'))
  const sessions = join(cp, project.replace(/[^a-zA-Z0-9]/g, '-'))
  mkdirSync(sessions)
  writeFileSync(
    join(sessions, 's1.jsonl'),
    [
      JSON.stringify({ type: 'user', timestamp: '2026-10-16T10:00:00Z', message: { role: 'user', content: 'Add a login page' } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Done.\n\nSkipped the tests.' }] } })
    ].join('\n')
  )
  writeFileSync(join(project, 'a.ts'), '// shortcut: no retry\n')
  writeFileSync(join(sessions, `${SESSION}.jsonl`), '') // the session fake-claude reports, so it can be resumed
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      CCM_SKIP_SETUP: '1',
      CCM_USER_DATA: mkdtempSync(join(tmpdir(), 'ccm-data-')),
      CCM_PROJECT: project,
      CCM_TEST_PIDS: pids,
      CCM_CMD_CLAUDE: join(fixtures, 'fake-claude.cmd'),
      CCM_CMD_HEADROOM: stub,
      CCM_MEMORY_DIR: memory,
      CCM_CLAUDE_PROJECTS: cp,
      CCM_CMD_DISTILLER: `node "${join(fixtures, 'fake-distiller.mjs')}"`,
      CCM_CMD_CLASSIFIER: `node "${join(fixtures, 'fake-skipcheck.mjs')}"`,
      CCM_FAKE_SKIP: JSON.stringify({ 'Done.\nSkipped the tests.': [true, false] })
    }
  })
  const win = await app.firstWindow()
  const term = win.locator('.xterm-rows')

  await expect(term).toContainText('FAKE CLAUDE READY', { timeout: 30_000 })
  await expect(term).toContainText('ANTHROPIC_BASE_URL=http://127.0.0.1:')
  await expect(term).toContainText('ARGS=--settings')
  await expect(term).toContainText('AUTO_MEMORY_OFF=1')
  await expect.poll(() => existsSync(join(memory, '.git')), { timeout: 15_000 }).toBe(true)
  await expect(term).toContainText('USAGE_FILE=')
  await expect(win.getByText('Headroom: running')).toBeVisible({ timeout: 30_000 })
  // fake-claude plays the status line script once, like Claude Code does after a response.
  await expect(win.getByText('5h: 42%')).toBeVisible({ timeout: 15_000 })
  await expect(win.getByText('Context: 31%')).toBeVisible()

  // Model and toggles restart Claude, ask first while the cache is warm, and resume this exact session.
  const asked: string[] = []
  win.on('dialog', d => {
    asked.push(d.message())
    void d.accept()
  })
  await win.getByLabel('Model').selectOption('sonnet')
  await expect(term).toContainText(`--model sonnet --resume ${SESSION}`)
  await expect(win.getByText(/Cache: (warm|cold in)/)).toBeVisible({ timeout: 15_000 }) // the relaunched session reported again
  await win.getByRole('button', { name: 'Lean on' }).click()
  await expect(win.getByRole('button', { name: 'Lean off' })).toBeVisible()
  await expect(term).toContainText(`--resume ${SESSION}`)
  expect(asked).toHaveLength(2)
  expect(asked[0]).toContain('warm cache')

  await win.getByRole('tab', { name: 'Savings' }).click()
  await expect(win.locator('webview')).toHaveAttribute('src', /^http:\/\/127\.0\.0\.1:\d+\/dashboard$/)

  await win.getByRole('tab', { name: 'Tasks' }).click()
  await expect(win.getByText('Add a login page')).toBeVisible({ timeout: 15_000 })
  await expect(win.getByText('Skipped: check why')).toBeVisible({ timeout: 15_000 })
  await expect(win.getByText('No reason given')).toBeVisible()

  const started = readdirSync(pids).map(f => Number(f.split('-')[1]))
  expect(started.length).toBeGreaterThanOrEqual(2) // claude + headroom stub

  await app.close()
  await expect.poll(() => started.filter(alive), { timeout: 15_000 }).toEqual([])
})
