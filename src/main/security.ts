import { isAbsolute, relative, resolve } from 'node:path'

// Panels may only load the local tool dashboards.
export function isAllowedUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
}

// True when `file` (relative to the project, or absolute) is inside `projectDir`.
export function isInside(projectDir: string, file: string): boolean {
  if (!file) return false
  const r = relative(projectDir, resolve(projectDir, file))
  return r !== '' && !r.startsWith('..') && !isAbsolute(r)
}
