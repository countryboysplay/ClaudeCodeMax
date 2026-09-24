import { defineConfig } from 'vitest/config'

// memory tests spawn git and node; the 5s default flakes on Windows
export default defineConfig({ test: { include: ['test/**/*.test.ts'], environment: 'node', testTimeout: 30000 } })
