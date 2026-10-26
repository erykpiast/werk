/** A copy of e2e/harness.ts that can start from an empty project, and exposes the server pid. */
import { test as base, expect } from '@playwright/test'
import { spawn, spawnSync, type ChildProcessByStdio } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable } from 'node:stream'

export const ROOT = join(import.meta.dirname, '..', '..')
export const MAIN = join(ROOT, 'src', 'cli', 'main.ts')
const FAKE_AGENT = join(ROOT, 'src', 'test', 'fake-agent.ts')
const FIXTURE = join(ROOT, 'e2e', 'fixture-project')

export type Werk = {
  url: string
  dir: string
  pid: number
  env: Record<string, string>
  cli: (args: string[]) => string
  tryCli: (args: string[]) => { code: number | null; stdout: string; stderr: string }
  log: () => { type: string; actor: string; payload: Record<string, unknown> }[]
}

export const test = base.extend<{ werk: Werk; project: 'fixture' | 'empty' }>({
  project: ['empty', { option: true }],
  werk: [
    async ({ page, project }, use, testInfo) => {
      const root = mkdtempSync(join(tmpdir(), 'werk-heldout-e2e-'))
      const dir = join(root, 'project')
      const bin = join(root, 'bin')
      if (project === 'fixture') cpSync(FIXTURE, dir, { recursive: true })
      else mkdirSync(join(dir, '.werk'), { recursive: true })
      mkdirSync(bin)
      writeFileSync(join(bin, 'claude'), `#!/bin/sh\nexec bun ${JSON.stringify(FAKE_AGENT)} "$@"\n`)
      chmodSync(join(bin, 'claude'), 0o755)
      writeFileSync(join(root, 'agent-script.json'), JSON.stringify({ steps: [] }))
      const env = {
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        HOME: root,
        TMPDIR: tmpdir(),
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        WERK_FAKE_AGENT_SCRIPT: join(root, 'agent-script.json'),
      }
      const tryRun = (cmd: string, args: string[]) => {
        const r = spawnSync(cmd, args, { cwd: dir, env, encoding: 'utf8' })
        return { code: r.status, stdout: r.stdout, stderr: r.stderr }
      }
      const run = (cmd: string, args: string[]) => {
        const r = tryRun(cmd, args)
        if (r.code !== 0) throw new Error(`${cmd} ${args.join(' ')} exited ${r.code}: ${r.stderr}${r.stdout}`)
        return r.stdout
      }
      run('git', ['init', '--quiet', '--initial-branch=main'])
      run('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'commit', '--quiet', '--allow-empty', '-m', 'start'])

      const server = spawn('bun', [MAIN, 'serve', '--port', '0'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] })
      try {
        const url = await addressOf(server)
        const host = new URL(url).host
        await page.context().route('**/*', (route) =>
          new URL(route.request().url()).host === host ? route.continue() : route.abort('blockedbyclient'),
        )
        await use({
          url,
          dir,
          pid: server.pid!,
          env,
          cli: (args) => run('bun', [MAIN, ...args]),
          tryCli: (args) => tryRun('bun', [MAIN, ...args]),
          log: () =>
            readFileSync(join(dir, '.werk', 'log.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)),
        })
      } finally {
        await page.screenshot({ path: testInfo.outputPath('evidence.png'), fullPage: true }).catch(() => {})
        await stop(server)
        rmSync(root, { recursive: true, force: true })
      }
    },
    { auto: true },
  ],
})
export { expect }

type Server = ChildProcessByStdio<null, Readable, Readable>
function addressOf(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = ''
    let err = ''
    const timer = setTimeout(() => reject(new Error(`no address. stderr: ${err}`)), 20_000)
    server.stderr.on('data', (c: Buffer) => (err += c.toString()))
    server.stdout.on('data', (c: Buffer) => {
      out += c.toString()
      const m = out.match(/http:\/\/\S+\//)
      if (m) {
        clearTimeout(timer)
        resolve(m[0])
      }
    })
    server.on('exit', (code) => reject(new Error(`serve exited ${code}: ${err}`)))
  })
}
async function stop(server: Server) {
  if (server.exitCode !== null || server.signalCode !== null) return
  const exited = new Promise((r) => server.once('exit', r))
  server.kill('SIGTERM')
  const t = setTimeout(() => server.kill('SIGKILL'), 5000)
  await exited
  clearTimeout(t)
}

/** Seeding helpers that use the command line the way an agent does. */
export function realCard(werk: Werk, id: string, title: string, parent?: string, extra: string[] = []) {
  werk.cli(['add', id, '--title', title, ...(parent ? ['--parent', parent] : []), ...extra])
  werk.cli(['accept', id, '--actor', 'you'])
}
/** A real decided card: decider me, a basis (its parent, or a no-basis reason), a kill criterion. */
export function decidedCard(werk: Werk, id: string, title: string, parent?: string, deps: string[] = []) {
  realCard(werk, id, title, parent, ['--who', 'me'])
  if (!parent && deps.length === 0) werk.cli(['edit', id, '--no-basis', 'a root'])
  werk.cli(['kill', id, '--form', 'revisit'])
  for (const d of deps) werk.cli(['link', id, d, '--type', 'depends_on', '--why', `takes from ${d}`])
  werk.cli(['status', id, 'decided'])
}
