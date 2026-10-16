import { test, expect, _electron as electron } from '@playwright/test'
import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const fixtures = resolve('test/fixtures')
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
      CCM_CLAUDE_PROJECTS: mkdtempSync(join(tmpdir(), 'ccm-cp-')),
      CCM_CMD_DISTILLER: `node "${join(fixtures, 'fake-distiller.mjs')}"`
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

  await win.getByRole('tab', { name: 'Savings' }).click()
  await expect(win.locator('webview')).toHaveAttribute('src', /^http:\/\/127\.0\.0\.1:\d+\/dashboard$/)

  const started = readdirSync(pids).map(f => Number(f.split('-')[1]))
  expect(started.length).toBeGreaterThanOrEqual(2) // claude + headroom stub

  await app.close()
  await expect.poll(() => started.filter(alive), { timeout: 15_000 }).toEqual([])
})
