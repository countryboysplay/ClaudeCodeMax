import { test, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const fixtures = resolve('test/fixtures')
const stub = `node "${join(fixtures, 'stub-server.mjs')}" {port}`
const baseEnv = () => ({
  ...process.env,
  CCM_USER_DATA: mkdtempSync(join(tmpdir(), 'ccm-data-')),
  CCM_CMD_CLAUDE: join(fixtures, 'fake-claude.cmd'),
  CCM_CMD_CODEBURN: stub,
  CCM_CMD_HEADROOM: stub
})

for (const scheme of ['light', 'dark'] as const) {
  test(`dashboard screenshots (${scheme})`, async () => {
    const app = await electron.launch({
      args: ['.'],
      env: { ...baseEnv(), CCM_SKIP_SETUP: '1', CCM_PROJECT: mkdtempSync(join(tmpdir(), 'ccm project ')) }
    })
    const win = await app.firstWindow()
    await win.emulateMedia({ colorScheme: scheme })
    await win.getByText('Codeburn: running').waitFor({ timeout: 30_000 })
    for (const tab of ['Cost', 'Graph', 'Savings']) {
      await win.getByRole('tab', { name: tab }).click()
      await win.screenshot({ path: `screens/dashboard-${tab.toLowerCase()}-${scheme}.png` })
    }
    await app.close()
  })

  test(`wizard screenshot (${scheme})`, async () => {
    const app = await electron.launch({ args: ['.'], env: { ...baseEnv(), CCM_FORCE_SETUP: '1' } })
    const win = await app.firstWindow()
    await win.emulateMedia({ colorScheme: scheme })
    await win.getByRole('heading', { name: 'Set up ClaudeCodeMax' }).waitFor({ timeout: 60_000 })
    await win.screenshot({ path: `screens/wizard-${scheme}.png` })
    await app.close()
  })
}
