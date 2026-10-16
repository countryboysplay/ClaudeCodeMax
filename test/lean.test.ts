import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { leanSettings, readLeanInputs } from '../src/main/lean'

const user = {
  enabledPlugins: {
    'superpowers@claude-plugins-official': true,
    'ponytail@ponytail': true,
    'rust-analyzer-lsp@claude-plugins-official': true,
    'frontend-design@claude-plugins-official': false,
    'claude-memory@anthropic-plugin-directory': true
  },
  skillOverrides: { 'rainbow-weather-api': 'off' }
}

describe('leanSettings', () => {
  const s = leanSettings({ user, project: [], userSkills: ['graphify', 'impeccable', 'rainbow-weather-api'] })

  it('turns off claude.ai connectors, synced skills and plugins, and built-in skills', () =>
    expect(s).toMatchObject({ disableClaudeAiConnectors: true, syncClaudeAiSkills: false, syncClaudeAiPlugins: false, disableBundledSkills: true }))

  it('disables globally enabled plugins except Ponytail and code-intelligence (LSP) plugins', () =>
    expect(s.enabledPlugins).toEqual({ 'superpowers@claude-plugins-official': false, 'claude-memory@anthropic-plugin-directory': false }))

  it('keeps a plugin the project turns on itself', () => {
    const p = leanSettings({ user, project: [{ enabledPlugins: { 'superpowers@claude-plugins-official': true } }], userSkills: [] })
    expect(p.enabledPlugins).toEqual({ 'claude-memory@anthropic-plugin-directory': false })
  })

  it('hides personal skills from Claude but keeps choices the user already made', () =>
    expect(s.skillOverrides).toEqual({ graphify: 'user-invocable-only', impeccable: 'user-invocable-only', 'rainbow-weather-api': 'off' }))

  it('survives missing or malformed settings', () => {
    const e = leanSettings({ user: { enabledPlugins: 'nope' }, project: [null as unknown as Record<string, unknown>], userSkills: [] })
    expect(e.enabledPlugins).toEqual({})
    expect(e.skillOverrides).toEqual({})
  })
})

describe('readLeanInputs', () => {
  it('reads user and project settings and skill folders, skipping synced and hidden folders', () => {
    const home = mkdtempSync(join(tmpdir(), 'ccm-home-'))
    const project = mkdtempSync(join(tmpdir(), 'ccm-proj-'))
    mkdirSync(join(home, 'skills', 'graphify'), { recursive: true })
    mkdirSync(join(home, 'skills', 'synced'), { recursive: true })
    mkdirSync(join(home, 'skills', '.trash'), { recursive: true })
    writeFileSync(join(home, 'skills', 'notes.txt'), '')
    writeFileSync(join(home, 'settings.json'), JSON.stringify(user))
    mkdirSync(join(project, '.claude'))
    writeFileSync(join(project, '.claude', 'settings.local.json'), '{ broken')
    const r = readLeanInputs(home, project)
    expect(r.user).toEqual(user)
    expect(r.project).toEqual([{}, {}])
    expect(r.userSkills).toEqual(['graphify'])
  })
})
