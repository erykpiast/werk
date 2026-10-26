import { expect } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../../src/test/harness.ts'

export { makeProject, type Project }

export const logLines = (p: Project) => {
  const path = join(p.dir, '.werk', 'log.jsonl')
  return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean) : []
}

/** Runs werk and expects success. */
export const ok = (p: Project, args: string[]) => {
  const r = p.werk(args)
  if (r.code !== 0) throw new Error(`werk ${args.join(' ')} exited ${r.code}: ${r.stderr}${r.stdout}`)
  return r
}

/** Proposes a card and accepts it with the person's claim. */
export const realCard = (p: Project, id: string, title: string, parent?: string, extra: string[] = []) => {
  ok(p, ['add', id, '--title', title, '--who', 'agent', ...(parent ? ['--parent', parent] : []), ...extra])
  ok(p, ['accept', id, '--actor', 'you'])
}

/** Makes a real card decided: a basis when it has none, a kill criterion, then the decide. */
export const decide = (p: Project, id: string, needsBasis: boolean) => {
  if (needsBasis) ok(p, ['edit', id, '--no-basis', 'a root card'])
  ok(p, ['kill', id, '--form', 'manual', '--text', `use ${id} for a week`])
  ok(p, ['status', id, 'decided'])
}

/** The ids of the cards that refine `id`, from the show output. */
export const childrenOf = (p: Project, id: string) =>
  [...p.werk(['show', id]).stdout.matchAll(/^link: refines <- #(\S+)/gm)].map((m) => m[1])

export const parentOf = (p: Project, id: string) => p.werk(['show', id]).stdout.match(/^parent: #(\S+)/m)?.[1]

export { expect }
