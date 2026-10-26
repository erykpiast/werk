import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project, type RunResult } from '../src/test/harness.ts'

export { makeProject, type Project, type RunResult }

export const logFile = (p: Project) => join(p.dir, '.werk', 'log.jsonl')
export const logLines = (p: Project): string[] =>
  existsSync(logFile(p)) ? readFileSync(logFile(p), 'utf8').split('\n').filter(Boolean) : []
export const logEvents = (p: Project) => logLines(p).map((l) => JSON.parse(l))
export const logText = (p: Project) => (existsSync(logFile(p)) ? readFileSync(logFile(p), 'utf8') : '')

export function ok(r: RunResult, what: string): RunResult {
  if (r.code !== 0) throw new Error(`${what} exited ${r.code}: ${r.stdout}${r.stderr}`)
  return r
}

/** Adds a card and accepts it with the person's claim, so it is real. */
export function realCard(p: Project, id: string, title: string, extra: string[] = []) {
  ok(p.werk(['add', id, '--title', title, ...extra]), `add ${id}`)
  ok(p.werk(['accept', id, '--actor', 'you']), `accept ${id}`)
}

export const show = (p: Project, id: string) => p.werk(['show', id])

/** Writes a session transcript where Claude Code keeps it, under HOME/.claude/projects. */
export function writeSession(p: Project, session: string, lines: unknown[]) {
  const dir = join(p.env.HOME!, '.claude', 'projects', '-tmp-project')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${session}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  return join(dir, `${session}.jsonl`)
}

export const userMsg = (text: string) => ({ type: 'user', message: { role: 'user', content: text } })
export const assistantMsg = (text: string) => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text }] },
})
export const summary = () => ({ type: 'summary', summary: 'x' })
