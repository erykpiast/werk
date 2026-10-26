/**
 * The build scenario of 98.1 and 98.5: one decided ticket, a builder reply and a grader reply
 * scripted by role. It takes the harness's makeProject, so a test in a clone can run it on
 * the clone's own werk.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

type Project = {
  dir: string
  run: (cmd: string[]) => { code: number; stdout: string; stderr: string }
  werk: (args: string[]) => { code: number; stdout: string; stderr: string }
  scriptAgent: (script: unknown) => void
  agentLaunches: () => string[][]
  agentRoles: () => (string | undefined)[]
  agentInputs: () => unknown[][]
}

const reply = (object: unknown) => ({
  steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
})
export const BUILDER = { steps: [{ edit: { path: 'built.txt', content: 'zebra quokka\n' } }, ...reply({}).steps], exit: 0 }
export const GRADER = reply({ lines: ['ac-1', '#loop', '#root'].map((id) => ({ id, score: 4, gap: 'walrus' })) })
export const REVIEWERS = ['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => `reviewer-${a}`)

export function setUp(makeProject: () => Project): Project {
  const p = makeProject()
  writeFileSync(join(p.dir, 'Makefile'), 'check:\n\t@test -f built.txt\n')
  p.run(['git', 'add', 'Makefile'])
  p.run(['git', 'commit', '--quiet', '-m', 'Add the check'])
  const werk = join(p.dir, '.werk')
  mkdirSync(join(werk, 'plans', 'root'), { recursive: true })
  const events = [
    { type: 'node.proposed', payload: { id: 'root', kind: 'card', title: 'Root', status: 'decided' } },
    { type: 'node.proposed', payload: { id: 'loop', kind: 'card', title: 'The loop', status: 'decided', parent: 'root', body: 'The loop body.' } },
    { type: 'node.accepted', payload: { id: 'loop' } },
  ]
  writeFileSync(
    join(werk, 'log.jsonl'),
    events.map((e, i) => JSON.stringify({ actor: 'agent', ...e, seq: i + 1, at: '2026-10-21T00:00:00.000Z' })).join('\n') + '\n',
  )
  const ticket = {
    number: 3,
    title: 'The thing is built',
    cites: ['loop'],
    blockedBy: [],
    stories: [1],
    touches: ['builder loop'],
    checks: ['make check'],
    brief: '## What to build\n\nMake the file.\n\n## Acceptance criteria\n\n- The file is there.',
    root: 'root',
  }
  writeFileSync(
    join(werk, 'board.jsonl'),
    JSON.stringify({ type: 'ticket.planned', payload: ticket, seq: 1, at: '2026-10-21T00:00:00.000Z', actor: 'agent' }) + '\n',
  )
  writeFileSync(join(werk, 'plans', 'root', 'spec.md'), '# Spec\n\n## User stories\n\n1. As a builder, I want the file.\n')
  // One reply per role. The replies hold no word of any prompt.
  p.scriptAgent({
    steps: [],
    roles: { builder: BUILDER, grader: GRADER, ...Object.fromEntries(REVIEWERS.map((r) => [r, reply({ findings: [] })])) },
  })
  return p
}

/** The prompt of each launch: its argv text and its first user message on stdin. */
export const promptsOf = (p: Project) => {
  const inputs = p.agentInputs()
  return p.agentLaunches().map((argv, i) => argv.join(' ') + '\n' + inputs[i]!.map((m) => JSON.stringify(m)).join('\n'))
}

export type Outcome = { code: number; stdout: string; stderr: string; branchFiles: string[]; roles: (string | undefined)[]; prompts: string[] }

export function runBuild(p: Project): Outcome {
  const r = p.werk(['build', '3'])
  const branch = /werk-build\/[\w-]+/.exec(r.stdout)?.[0]
  const branchFiles = branch ? p.run(['git', 'ls-tree', '--name-only', branch]).stdout.trim().split('\n') : []
  return { ...r, branchFiles, roles: p.agentRoles(), prompts: promptsOf(p) }
}
