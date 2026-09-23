import type { Runner } from './run'
import { atLeast } from './version'

export interface Step {
  id: string
  label: string
  required: boolean
  requires?: string
  check: string
  minVersion?: string
  checkIncludes?: string
  install: string[]
}

const WINGET = '--exact --silent --accept-source-agreements --accept-package-agreements'

export const STEPS: Step[] = [
  { id: 'git', label: 'Git for Windows', required: true, check: 'git --version', install: [`winget install --id Git.Git ${WINGET}`] },
  {
    id: 'node',
    label: 'Node.js 22.13+',
    required: true,
    check: 'node -v',
    minVersion: '22.13.0',
    install: [`winget install --id OpenJS.NodeJS.LTS ${WINGET} || winget upgrade --id OpenJS.NodeJS.LTS ${WINGET}`]
  },
  { id: 'uv', label: 'uv (Python tools)', required: false, check: 'uv --version', install: [`winget install --id astral-sh.uv ${WINGET}`] },
  {
    id: 'claude',
    label: 'Claude Code',
    required: true,
    check: 'claude --version',
    install: ['powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://claude.ai/install.ps1 | iex"']
  },
  { id: 'codeburn', label: 'Codeburn', required: true, requires: 'node', check: 'codeburn --version', install: ['npm install -g codeburn'] },
  {
    id: 'headroom',
    label: 'Headroom',
    required: false,
    requires: 'uv',
    check: 'headroom --version',
    install: ['uv tool install --python 3.13 "headroom-ai[all]"']
  },
  {
    id: 'graphify',
    label: 'Graphify',
    required: false,
    requires: 'uv',
    check: 'graphify --version',
    install: ['uv tool install graphifyy', 'graphify install']
  },
  {
    id: 'ponytail',
    label: 'Ponytail',
    required: false,
    requires: 'claude',
    check: 'claude plugin list',
    checkIncludes: 'ponytail',
    install: ['claude plugin marketplace add DietrichGebert/ponytail', 'claude plugin install ponytail@ponytail -y']
  }
]

export async function check(step: Step, run: Runner): Promise<boolean> {
  const { code, output } = await run(step.check)
  if (code !== 0) return false
  if (step.minVersion && !atLeast(output, step.minVersion)) return false
  if (step.checkIncludes && !output.toLowerCase().includes(step.checkIncludes)) return false
  return true
}

export async function install(step: Step, run: Runner, onLine: (l: string) => void): Promise<{ ok: boolean; error?: string }> {
  for (const cmd of step.install) {
    onLine(`> ${cmd}`)
    const { code, output } = await run(cmd, onLine)
    if (code !== 0) return { ok: false, error: output.trim().split(/\r?\n/).slice(-20).join('\n') || `Exited with code ${code}` }
  }
  return { ok: true }
}

export function blockedBy(step: Step, results: Record<string, boolean>): string | null {
  if (!step.requires || results[step.requires]) return null
  return STEPS.find(s => s.id === step.requires)?.label ?? step.requires
}

export function needsWizard(results: Record<string, boolean>, skipped: string[]): boolean {
  return STEPS.some(s => !results[s.id] && (s.required || !skipped.includes(s.id)))
}
