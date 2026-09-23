import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, readdirSync } from 'node:fs'
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

test('runs Claude in the project, serves the Cost panel, and leaves no orphans', async () => {
  const pids = mkdtempSync(join(tmpdir(), 'ccm-pids-'))
  const project = mkdtempSync(join(tmpdir(), 'ccm project ')) // space on purpose
  const stub = `node "${join(fixtures, 'stub-server.mjs')}" {port}`
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      CCM_SKIP_SETUP: '1',
      CCM_USER_DATA: mkdtempSync(join(tmpdir(), 'ccm-data-')),
      CCM_PROJECT: project,
      CCM_TEST_PIDS: pids,
      CCM_CMD_CLAUDE: join(fixtures, 'fake-claude.cmd'),
      CCM_CMD_CODEBURN: stub,
      CCM_CMD_HEADROOM: stub
    }
  })
  const win = await app.firstWindow()
  const term = win.locator('.xterm-rows')

  await expect(term).toContainText('FAKE CLAUDE READY', { timeout: 30_000 })
  await expect(term).toContainText('ANTHROPIC_BASE_URL=http://127.0.0.1:')
  await expect(win.getByText('Codeburn: running')).toBeVisible({ timeout: 30_000 })

  await win.getByRole('tab', { name: 'Cost' }).click()
  // Electron's <webview> rewrites its `src` attribute to the guest's actual navigated URL once
  // navigation completes, and Chromium canonicalizes a bare-origin URL by appending a trailing
  // slash (e.g. "http://localhost:4747" -> "http://localhost:4747/"). Allow that trailing slash.
  await expect(win.locator('webview')).toHaveAttribute('src', /^http:\/\/localhost:\d+\/?$/)

  await win.getByRole('tab', { name: 'Graph' }).click()
  await expect(win.getByRole('button', { name: 'Build graph' })).toBeVisible()

  const started = readdirSync(pids).map(f => Number(f.split('-')[1]))
  expect(started.length).toBeGreaterThanOrEqual(3) // claude + codeburn stub + headroom stub

  await app.close()
  await expect.poll(() => started.filter(alive), { timeout: 15_000 }).toEqual([])
})
