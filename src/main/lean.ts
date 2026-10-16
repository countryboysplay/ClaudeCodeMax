import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

type Json = Record<string, unknown>
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {})
// Ponytail has its own header toggle. LSP plugins add one tool that gives Claude real type
// information, which helps accuracy for almost no context.
const keep = (id: string) => id === 'ponytail@ponytail' || /-lsp@/.test(id)

export interface LeanInputs {
  user: Json
  project: Json[]
  userSkills: string[]
}

// Settings for app-launched sessions that keep skill descriptions, plugins and claude.ai
// connectors out of Claude's context. Passed with --settings, so ~/.claude is never touched.
export function leanSettings({ user, project, userSkills }: LeanInputs): Json {
  const projectOn = new Set(project.flatMap(p => Object.entries(obj(obj(p).enabledPlugins)).filter(([, on]) => on === true).map(([id]) => id)))
  const enabledPlugins = Object.fromEntries(
    Object.entries(obj(user.enabledPlugins))
      .filter(([id, on]) => on === true && !keep(id) && !projectOn.has(id))
      .map(([id]) => [id, false])
  )
  // Hidden from Claude, still runnable by typing /name. Choices the user already made win.
  const skillOverrides = { ...Object.fromEntries(userSkills.map(s => [s, 'user-invocable-only'])), ...obj(user.skillOverrides) }
  return {
    disableClaudeAiConnectors: true,
    syncClaudeAiSkills: false,
    syncClaudeAiPlugins: false,
    disableBundledSkills: true,
    enabledPlugins,
    skillOverrides
  }
}

export function readLeanInputs(claudeHome: string, projectDir: string | null): LeanInputs {
  const read = (f: string): Json => {
    try {
      return obj(JSON.parse(readFileSync(f, 'utf8')))
    } catch {
      return {} // missing or malformed: nothing to keep
    }
  }
  const skills = join(claudeHome, 'skills')
  return {
    user: read(join(claudeHome, 'settings.json')),
    project: projectDir ? ['settings.json', 'settings.local.json'].map(f => read(join(projectDir, '.claude', f))) : [],
    // `synced` holds claude.ai skills, which syncClaudeAiSkills already covers; dot folders aren't skills.
    userSkills: existsSync(skills) ? readdirSync(skills, { withFileTypes: true }).filter(d => d.isDirectory() && d.name !== 'synced' && !d.name.startsWith('.')).map(d => d.name) : []
  }
}
