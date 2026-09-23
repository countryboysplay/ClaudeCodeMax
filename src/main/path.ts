import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

const MACHINE_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'
const USER_KEY = 'HKCU\\Environment'

export function parseRegQuery(out: string): string {
  const m = out.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/i)
  return m ? m[1].trim() : ''
}

function expandVars(s: string, env: NodeJS.ProcessEnv): string {
  return s.replace(/%([^%]+)%/g, (whole, name: string) => {
    const key = Object.keys(env).find(k => k.toLowerCase() === name.toLowerCase())
    return key ? env[key]! : whole
  })
}

export function mergePath(parts: string[], env: NodeJS.ProcessEnv): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of parts.join(';').split(';')) {
    const p = expandVars(raw.trim(), env)
    const key = p.toLowerCase().replace(/[\\/]+$/, '')
    if (!p || seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  return out.join(';')
}

function readRegPath(key: string): string {
  try {
    return parseRegQuery(execFileSync('reg', ['query', key, '/v', 'Path'], { encoding: 'utf8', windowsHide: true }))
  } catch {
    return ''
  }
}

// Re-read PATH after winget/npm/uv installs so new tools are found without restarting the app.
export function refreshPath(env: NodeJS.ProcessEnv = process.env): void {
  const extras = [join(homedir(), '.local', 'bin'), join(env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'npm')]
  env.Path = mergePath([readRegPath(MACHINE_KEY), readRegPath(USER_KEY), ...extras, env.Path ?? env.PATH ?? ''], env)
}
