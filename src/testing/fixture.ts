/**
 * The test fixture for the build pipeline. See #st-build-seam.
 *
 * A temporary git repository, a decision log in it, and a fake `claude` first on the PATH.
 * Tests run the real command line against it and read what a person would read: the exit
 * code, the branches and commits, the files, and the logs.
 */
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FakeCall, FakeRule } from './fake-claude.ts'

export const SRC = join(import.meta.dir, '..')
export const CLI = join(SRC, 'cli.ts')
const FAKE = join(import.meta.dir, 'fake-claude.ts')

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
}

export function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
  return r.stdout.trim()
}

/** A fresh repository on branch main with one commit. `files` go into that commit. */
export function makeRepo(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'werk-test-repo-'))
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.name', 'Test')
  git(dir, 'config', 'user.email', 'test@example.com')
  writeFileSync(join(dir, '.gitignore'), '.werk/\n')
  for (const [path, content] of Object.entries({ 'README.md': 'test repo\n', ...files })) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'initial')
  return dir
}

export type Fake = { bin: string; script: string; calls: () => FakeCall[] }

/** A directory with a `claude` that plays `rules`. Put `bin` first on the PATH. */
export function fakeClaude(rules: FakeRule[]): Fake {
  const bin = mkdtempSync(join(tmpdir(), 'werk-fake-claude-'))
  const script = join(bin, 'script.json')
  writeFileSync(script, JSON.stringify({ rules }))
  const shim = join(bin, 'claude')
  writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`)
  chmodSync(shim, 0o755)
  const calls = () => {
    const path = `${script}.calls.jsonl`
    if (!existsSync(path)) return []
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as FakeCall)
  }
  return { bin, script, calls }
}

/** One decided card, as a node.added event payload. */
export type CardSpec = { id: string; title?: string; body?: string; status?: string; parent?: string; dependsOn?: string[] }

/** Write a decision log of `cards` to <repo>/.werk/log.jsonl. */
export function writeLog(repo: string, cards: CardSpec[], extra: Array<{ type: string; payload: unknown }> = []): string {
  const path = join(repo, '.werk', 'log.jsonl')
  mkdirSync(join(repo, '.werk'), { recursive: true })
  const events: Array<{ type: string; payload: unknown }> = []
  for (const c of cards) {
    events.push({
      type: 'node.added',
      payload: { id: c.id, kind: 'card', title: c.title ?? c.id, body: c.body ?? `body of ${c.id}`, status: c.status ?? 'decided', who: 'me', noBasis: true },
    })
    if (c.parent) events.push({ type: 'edge.added', payload: { from: c.id, to: c.parent, type: 'refines' } })
    for (const d of c.dependsOn ?? []) events.push({ type: 'edge.added', payload: { from: c.id, to: d, type: 'depends_on' } })
  }
  events.push(...extra)
  const lines = events.map((e, i) => JSON.stringify({ seq: i + 1, at: '2026-10-01T10:00:00.000Z', actor: 'agent', ...e }))
  writeFileSync(path, lines.join('\n') + '\n')
  return path
}

export function readJsonl<T = any>(path: string): T[] {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T)
}

export type CliRun = { code: number; stdout: string; stderr: string }

function cliEnv(repo: string, fake: Fake, env: Record<string, string>) {
  return {
    ...process.env,
    ...GIT_ENV,
    PATH: `${fake.bin}:${process.env.PATH}`,
    FAKE_CLAUDE_SCRIPT: fake.script,
    WERK_LOG: join(repo, '.werk', 'log.jsonl'),
    WERK_BOARD: join(repo, '.werk', 'board.jsonl'),
    WERK_PIPELINE: join(repo, '.werk', 'pipeline.jsonl'),
    ...env,
  }
}

/** Run `werk <args>` in `repo`, with the fake claude on the PATH. */
export function runCli(repo: string, fake: Fake, args: string[], env: Record<string, string> = {}): Promise<CliRun> {
  return startCli(repo, fake, args, env).done
}

/** Start `werk <args>` and return the process, so a test can signal it. */
export function startCli(repo: string, fake: Fake, args: string[], env: Record<string, string> = {}) {
  const proc = spawn(process.execPath, [CLI, ...args], { cwd: repo, env: cliEnv(repo, fake, env), stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  proc.stdout.on('data', (d) => (stdout += d))
  proc.stderr.on('data', (d) => (stderr += d))
  const done = new Promise<CliRun>((resolve) => proc.on('exit', (code, sig) => resolve({ code: code ?? (sig ? 128 : -1), stdout, stderr })))
  return { proc, done }
}

/** Put one planned ticket on the board, with its file and the plan's spec. */
export function planTicket(repo: string, o: { run?: string; num?: string; text: string; spec?: string; blockedBy?: string[]; followUpOf?: string }): string {
  const run = o.run ?? 'r1'
  const num = o.num ?? '01'
  const file = join('.werk', 'tickets', run, `${num}.md`)
  mkdirSync(join(repo, '.werk', 'tickets', run), { recursive: true })
  writeFileSync(join(repo, file), o.text)
  if (o.spec) {
    mkdirSync(join(repo, '.werk', 'specs'), { recursive: true })
    writeFileSync(join(repo, '.werk', 'specs', `${run}.md`), o.spec)
  }
  const id = `${run}/${num}`
  const board = join(repo, '.werk', 'board.jsonl')
  const events = existsSync(board) ? readJsonl(board) : []
  const lines = []
  // #st-build-target: a build needs the project's target. The fixture keeps the map and the
  // code in one repository and writes the event directly, past the store-overlap refusal of
  // `werk target`, which its own tests cover.
  if (events.length === 0) lines.push({ seq: 1, at: '2026-10-01T10:00:00.000Z', actor: 'you', type: 'project.target', payload: { repo: realpathSync(repo) } })
  const seq = events.length + lines.length + 1
  lines.push({ seq, at: '2026-10-01T10:00:00.000Z', actor: 'agent', type: 'ticket.planned', payload: { id, run, file, title: num, blockedBy: o.blockedBy ?? [], ...(o.followUpOf ? { followUpOf: o.followUpOf } : {}) } })
  writeFileSync(board, (existsSync(board) ? readFileSync(board, 'utf8') : '') + lines.map((l) => JSON.stringify(l) + '\n').join(''))
  return id
}

/** A Makefile whose `test` target passes once done.txt exists. */
export const MAKEFILE = 'test:\n\t@test -f done.txt || (echo "done.txt is missing" && exit 1)\ntypecheck:\n\t@true\nlint:\n\t@true\n'
