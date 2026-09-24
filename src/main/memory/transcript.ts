import { closeSync, openSync, readSync, statSync } from 'node:fs'

export interface Slice {
  text: string
  end: number
  reads: string[]
  cwd: string | null
}

const PATH_TOOLS = ['Read', 'Edit', 'Write']

// Reads the transcript from `offset`, keeping what a person said and what Claude said.
// Tool output is dropped: it's most of the tokens and none of the lasting value.
export function sliceTranscript(file: string, offset: number, maxChars = 80_000): Slice {
  const size = statSync(file).size
  const start = offset > size ? 0 : offset
  const buf = Buffer.alloc(size - start)
  const fd = openSync(file, 'r')
  try {
    readSync(fd, buf, 0, buf.length, start)
  } finally {
    closeSync(fd)
  }
  const complete = buf.lastIndexOf(0x0a) + 1 // a partial last line is left for next time
  const parts: string[] = []
  const reads: string[] = []
  let cwd: string | null = null
  for (const raw of buf.subarray(0, complete).toString('utf8').split('\n')) {
    let o: any
    try {
      o = JSON.parse(raw)
    } catch {
      continue
    }
    if (!cwd && typeof o.cwd === 'string') cwd = o.cwd
    if (o.isMeta || o.isSidechain) continue
    const c = o.message?.content
    if (o.type === 'user') {
      if (typeof c === 'string') parts.push(`USER: ${c}`)
      else if (Array.isArray(c)) for (const b of c) if (b?.type === 'text') parts.push(`USER: ${b.text}`)
    } else if (o.type === 'assistant' && Array.isArray(c)) {
      for (const b of c) {
        if (b?.type === 'text') parts.push(`CLAUDE: ${b.text}`)
        if (b?.type !== 'tool_use') continue
        const p = typeof b.input?.file_path === 'string' ? (b.input.file_path as string) : null
        if (b.name === 'Read' && p) reads.push(p)
        parts.push(`TOOL: ${b.name}${p && PATH_TOOLS.includes(b.name) ? ` ${p}` : ''}`)
      }
    }
  }
  const text = parts.join('\n')
  return { text: text.length > maxChars ? text.slice(-maxChars) : text, end: start + complete, reads, cwd }
}
