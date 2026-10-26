import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../../src/test/harness.ts'

export { makeProject, type Project }

export const logFile = (p: Project) => join(p.dir, '.werk', 'log.jsonl')
export const logLines = (p: Project): string[] =>
  existsSync(logFile(p)) ? readFileSync(logFile(p), 'utf8').split('\n').filter(Boolean) : []
export const logSize = (p: Project): number => (existsSync(logFile(p)) ? readFileSync(logFile(p)).length : 0)

/** Writes a Given log directly, one JSON event per line. */
export function writeLog(p: Project, events: object[]) {
  mkdirSync(join(p.dir, '.werk'), { recursive: true })
  writeFileSync(logFile(p), events.map((e) => JSON.stringify(e)).join('\n') + '\n')
}

/** Puts a transcript for the session under HOME/.claude/projects/<dir>/. */
export function writeTranscript(p: Project, session: string, lines: object[]) {
  const dir = join(p.env.HOME!, '.claude', 'projects', '-some-project')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${session}.jsonl`)
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  return path
}

export const userLine = (text: string) => ({ type: 'user', message: { role: 'user', content: text } })
export const assistantLine = (text: string) => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text }] },
})
export const toolResultLine = () => ({
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }] },
})

/** Adds a card and accepts it, through the command line. */
export function realCard(p: Project, id: string, title: string) {
  const a = p.werk(['add', id, '--title', title])
  if (a.code !== 0) throw new Error(`add ${id}: ${a.stderr}`)
  const b = p.werk(['accept', id, '--actor', 'you'])
  if (b.code !== 0) throw new Error(`accept ${id}: ${b.stderr}`)
}
