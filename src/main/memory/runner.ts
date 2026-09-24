import { existsSync, readFileSync, readdirSync, rmSync, statSync, unwatchFile, watchFile } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { runShell, type Runner } from '../run'
import { projectPath, readMemory, slugFor, today, writeMemory, writeProject } from './files'
import { importAutoMemory } from './import'
import { rebuildIndexes } from './indexes'
import { archive, checkSources, promote, recordUse, refreshSources, splitSource, stampSources } from './maintain'
import { distillPrompt, parseVerdict, recheckPrompt } from './prompts'
import { commit, enqueue, ensureRepo, pathKey, readQueue, readState, removeJob, writeState } from './store'
import { sliceTranscript } from './transcript'
import { SECRET, changedFiles, problems, rollback } from './validate'

export interface RunnerOptions {
  root: string
  claudeProjects: string
  command: string
  model: string
  dailyCap: number
  indexCap: number
  run?: Runner
  today?: () => string
}

const MIN_CHARS = 8_000 // ~2k tokens: less isn't worth a model call
const TIMEOUT_MS = 5 * 60_000
const msg = (err: unknown) => (err instanceof Error ? err.message : String(err))

export class MemoryRunner {
  log: string[] = []
  private busy = false
  private halted = false
  private readonly run: Runner
  private readonly day: () => string

  constructor(private readonly o: RunnerOptions) {
    this.run = o.run ?? runShell
    this.day = o.today ?? today
  }

  private say(line: string): void {
    this.log = [...this.log, line].slice(-50)
  }

  private env(): NodeJS.ProcessEnv {
    return { ...process.env, CCM_DISTILLER: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' }
  }

  async init(): Promise<boolean> {
    const { root } = this.o
    try {
      await ensureRepo(root)
    } catch (err) {
      this.say(`Memory is off: ${msg(err)}`)
      this.halted = true
      return false
    }
    const s = readState(root)
    if (!s.imported) {
      const n = importAutoMemory(root, this.o.claudeProjects, slugFor(root))
      // History before the first launch arrives through the import, not by re-distilling every transcript.
      for (const f of this.transcripts()) s.offsets[pathKey(f)] = statSync(f).size
      s.imported = true
      writeState(root, s)
      this.say(`Imported ${n} auto-memory files.`)
    } else {
      for (const f of this.transcripts())
        if (statSync(f).size > (s.offsets[pathKey(f)] ?? 0)) enqueue(root, { kind: 'distill', transcript: f })
    }
    watchFile(join(root, '.queue'), { interval: 2000 }, () => void this.drain())
    await this.drain()
    return true
  }

  stop(): void {
    this.halted = true
    unwatchFile(join(this.o.root, '.queue'))
  }

  private transcripts(): string[] {
    const cp = this.o.claudeProjects
    const skip = slugFor(this.o.root) // the distiller's own sessions
    if (!existsSync(cp)) return []
    return readdirSync(cp, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name !== skip)
      .flatMap(d => readdirSync(join(cp, d.name)).filter(f => f.endsWith('.jsonl')).map(f => join(cp, d.name, f)))
  }

  async drain(): Promise<void> {
    if (this.busy || this.halted) return
    this.busy = true
    const { root } = this.o
    try {
      for (let job = readQueue(root)[0]; job && !this.halted; job = readQueue(root)[0]) {
        const s = readState(root)
        if (s.runs.day !== this.day()) s.runs = { day: this.day(), count: 0 }
        writeState(root, s)
        if (s.runs.count >= this.o.dailyCap) {
          this.say(`Daily cap of ${this.o.dailyCap} runs reached; ${readQueue(root).length} jobs wait for tomorrow.`)
          break
        }
        const ok = job.kind === 'distill' ? await this.distill(job.transcript) : await this.recheck(job.file)
        if (!ok) {
          this.halted = true // retried at next app start
          break
        }
        removeJob(root, job)
      }
      await this.maintain()
    } catch (err) {
      this.say(`Memory job failed: ${msg(err)}`)
      this.halted = true
    } finally {
      this.busy = false
    }
  }

  private countRun(): void {
    const s = readState(this.o.root)
    s.runs.count += 1
    writeState(this.o.root, s)
  }

  private command(tools: boolean): string {
    const { command, model } = this.o
    return `${command} -p --model ${model} --strict-mcp-config${tools ? ' --allowedTools Read,Write,Edit,Glob,Grep --permission-mode acceptEdits' : ''}`
  }

  private async distill(transcript: string): Promise<boolean> {
    const { root } = this.o
    if (!existsSync(transcript)) return true
    const key = pathKey(transcript)
    const slice = sliceTranscript(transcript, readState(root).offsets[key] ?? 0)
    const day = this.day()
    const worth = slice.text.length >= MIN_CHARS && !!slice.cwd
    recordUse(root, slice.reads, day)
    if (worth) writeProject(root, slugFor(slice.cwd!), slice.cwd!)
    // Commits hand edits too, so a rollback below only ever undoes the distiller.
    await commit(root, 'Record memory use')
    if (worth) {
      const slug = slugFor(slice.cwd!)
      const read = (f: string) => (existsSync(f) ? readFileSync(f, 'utf8') : '')
      const input = distillPrompt({
        slice: slice.text,
        globalIndex: read(join(root, 'INDEX.md')),
        projectIndex: read(join(root, 'projects', slug, 'INDEX.md')),
        projectDir: `projects/${slug}`,
        day
      })
      const r = await this.run(this.command(true), l => this.say(l), { cwd: root, env: this.env(), input, timeoutMs: TIMEOUT_MS })
      this.countRun()
      if (r.code !== 0) {
        await rollback(root)
        this.say(`Distiller exited with code ${r.code}; will retry at next start.`)
        return false
      }
      const bad = problems(root, await changedFiles(root))
      if (bad.length) {
        await rollback(root)
        this.say(`Discarded distiller changes: ${bad.join('; ')}`)
      } else {
        await stampSources(root, slug, slice.cwd!)
        promote(root)
        rebuildIndexes(root, this.o.indexCap, day)
        await commit(root, `Distill ${basename(transcript, '.jsonl')}`)
      }
    }
    const s = readState(root)
    s.offsets[key] = slice.end
    writeState(root, s)
    return true
  }

  private async recheck(file: string): Promise<boolean> {
    const { root } = this.o
    const m = readMemory(file)
    const dir = projectPath(root, basename(dirname(dirname(file)))) // projects/<slug>/topics/<name>.md
    if (!m || !dir) return true
    const sources = m.meta.sources.map(s => {
      const f = join(dir, splitSource(s)[0])
      return { file: splitSource(s)[0], text: existsSync(f) ? readFileSync(f, 'utf8').slice(0, 20_000) : null }
    })
    const r = await this.run(this.command(false), l => this.say(l), { cwd: root, env: this.env(), input: recheckPrompt(m, sources), timeoutMs: TIMEOUT_MS })
    this.countRun()
    if (r.code !== 0) {
      this.say(`Re-check exited with code ${r.code}; will retry at next start.`)
      return false
    }
    const v = parseVerdict(r.output)
    if (!v || (v.verdict === 'REWRITE' && !v.body.trim()) || SECRET.test(v.body)) {
      this.say(`Re-check of ${m.meta.name} gave no usable answer; it stays marked stale.`)
      return true
    }
    const day = this.day()
    if (v.verdict === 'DELETE') rmSync(file)
    else
      writeMemory({
        ...m,
        body: v.verdict === 'REWRITE' ? v.body : m.body,
        meta: { ...m.meta, verified: day, stale: false, sources: await refreshSources(dir, m.meta.sources) }
      })
    rebuildIndexes(root, this.o.indexCap, day)
    await commit(root, `Re-check ${m.meta.name}`)
    return true
  }

  private async maintain(): Promise<void> {
    const { root } = this.o
    const day = this.day()
    for (const file of await checkSources(root)) enqueue(root, { kind: 'recheck', file })
    archive(root, day)
    promote(root)
    rebuildIndexes(root, this.o.indexCap, day)
    await commit(root, 'Maintain memory')
  }
}
