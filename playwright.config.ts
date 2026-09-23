import { defineConfig } from '@playwright/test'

export default defineConfig({ testDir: 'test', testMatch: /.*\.spec\.ts/, timeout: 90_000, workers: 1 })
