import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isAllowedUrl } from '../src/main/security'

const project = 'C:\\Users\\me\\My Project'
const inGraph = (...p: string[]) => pathToFileURL(join(project, 'graphify-out', ...p)).href

describe('isAllowedUrl', () => {
  it.each([
    'http://localhost:4747',
    'http://localhost:4747/sessions?x=1',
    'http://127.0.0.1:8787/dashboard',
    inGraph('graph.html'),
    inGraph('assets', 'lib.js'),
    'file:///c:/users/me/my%20project/graphify-out/graph.html'
  ])('allows %s', url => expect(isAllowedUrl(url, project)).toBe(true))

  it.each([
    'https://localhost:4747',
    'http://localhost.evil.com',
    'http://127.0.0.2:4747',
    'http://example.com',
    'https://example.com',
    'javascript:alert(1)',
    'not a url',
    pathToFileURL(join(project, 'secret.txt')).href,
    'file:///C:/Users/me/My%20Project/graphify-out/../secret.txt',
    'file:///C:/Users/me/My%20Project/graphify-out-evil/graph.html',
    pathToFileURL(join(project, 'graphify-out')).href,
    'file://evil-host/share/graphify-out/graph.html'
  ])('blocks %s', url => expect(isAllowedUrl(url, project)).toBe(false))

  it('blocks file URLs when no project is open', () => expect(isAllowedUrl(inGraph('graph.html'), null)).toBe(false))
})
