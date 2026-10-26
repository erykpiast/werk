import { expect } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../../src/test/harness.ts'

export type P = Project & {
  ok: (args: string[]) => string
  logText: () => string
  events: () => any[]
  /** A real card, accepted by the person. */
  card: (id: string, title?: string, parent?: string) => void
  /** Puts the four decide facts on a real card (who me, a no-basis reason, a kill criterion). */
  facts: (id: string) => void
  decide: (id: string) => void
  /** Writes a recorded session transcript under the fake HOME's Claude config dir. */
  transcript: (session: string, lines: object[]) => string
  /** Every stale-list entry as { mark, id, lines } */
  staleEntries: () => { mark: string; id: string; lines: string[] }[]
}

export function project(): P {
  const p = makeProject() as P
  p.ok = (args) => {
    const r = p.werk(args)
    expect({ args, code: r.code, stderr: r.stderr }).toEqual({ args, code: 0, stderr: '' })
    return r.stdout
  }
  const log = join(p.dir, '.werk', 'log.jsonl')
  p.logText = () => (existsSync(log) ? readFileSync(log, 'utf8') : '')
  p.events = () => p.logText().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  p.card = (id, title = `Card ${id}`, parent) => {
    p.ok(['add', id, '--title', title, ...(parent ? ['--parent', parent] : [])])
    p.ok(['accept', id, '--actor', 'you'])
  }
  p.facts = (id) => {
    p.ok(['edit', id, '--who', 'me', '--no-basis', 'a held-out test card'])
    p.ok(['kill', id, '--form', 'manual', '--text', `use ${id} for a week`])
  }
  p.decide = (id) => {
    p.ok(['status', id, 'decided'])
  }
  p.transcript = (session, lines) => {
    const dir = join(p.env.HOME!, '.claude', 'projects', '-heldout-worktree')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, `${session}.jsonl`)
    writeFileSync(path, lines.map((l) => JSON.stringify(l) + '\n').join(''))
    return path
  }
  p.staleEntries = () => {
    const out = p.ok(['stale'])
    const entries: { mark: string; id: string; lines: string[] }[] = []
    for (const line of out.split('\n')) {
      const m = line.match(/^(stale|paused)\s+#(\S+)/)
      if (m) entries.push({ mark: m[1]!, id: m[2]!, lines: [line] })
      else if (line.startsWith('  ') && entries.length) entries.at(-1)!.lines.push(line)
      else if (line.trim() === '' || !line.startsWith('  ')) {
        // a blank or footer line ends no entry, but footer lines are not entry lines
        if (entries.length && line.trim() !== '') entries.push({ mark: '', id: '', lines: [] })
      }
    }
    return entries.filter((e) => e.id !== '')
  }
  return p
}

export const userLine = (session: string, text: string) => ({
  type: 'user',
  sessionId: session,
  message: { role: 'user', content: text },
})
export const assistantLine = (session: string, text: string) => ({
  type: 'assistant',
  sessionId: session,
  message: { role: 'assistant', content: [{ type: 'text', text }] },
})
