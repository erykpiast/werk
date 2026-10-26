/** A werk app copy served in dev mode (`bun --hot`, as `bun run dev` does) on a copy of the fixture project. */
import { test as base, expect } from '@playwright/test'
import { spawn, spawnSync, type ChildProcessByStdio } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import { copyApp, type AppCopy } from '../../src/test/app-copy.ts'
import type { FakeScript } from '../../src/test/fake-agent.ts'
import { writeFakeAgent } from '../../src/test/fake-bin.ts'

const FIXTURE = join(import.meta.dirname, '..', '..', 'e2e', 'fixture-project')

export type Dev = {
  url: string
  dir: string
  root: string
  app: AppCopy
  stderr: () => string
  serverPid: number
  scriptAgent: (s: FakeScript) => void
  launches: () => { argv: string[]; role?: string; pid: number }[]
}

const jsonLines = <T>(p: string): T[] => readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T)

export const test = base.extend<{ dev: Dev }>({
  dev: async ({}, use) => {
    const root = mkdtempSync(join(tmpdir(), 'werk-heldout-dev-'))
    const app = copyApp()
    const dir = join(root, 'project')
    const bin = join(root, 'bin')
    cpSync(FIXTURE, dir, { recursive: true })
    writeFakeAgent(bin, app.fakeAgent)
    const scriptPath = join(root, 'agent-script.json')
    const launchLog = join(root, 'agent-launches.jsonl')
    writeFileSync(launchLog, '')
    writeFileSync(join(root, 'agent-input.jsonl'), '')
    const env = {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      HOME: root,
      TMPDIR: tmpdir(),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      WERK_FAKE_AGENT_SCRIPT: scriptPath,
      WERK_FAKE_AGENT_LOG: launchLog,
      WERK_FAKE_AGENT_INPUT: join(root, 'agent-input.jsonl'),
    }
    for (const args of [['init', '-q', '-b', 'main'], ['config', 'user.name', 't'], ['config', 'user.email', 't@t.invalid'], ['add', '.'], ['commit', '-qm', 'fixture']])
      spawnSync('git', args, { cwd: dir, env })
    const server: ChildProcessByStdio<null, Readable, Readable> = spawn('bun', ['--hot', app.main, 'serve', '--port', '0'], {
      cwd: dir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let err = ''
    server.stderr.on('data', (c: Buffer) => (err += c.toString()))
    const url = await new Promise<string>((resolve, reject) => {
      let out = ''
      const t = setTimeout(() => reject(new Error(`no address. stderr: ${err}`)), 20_000)
      server.stdout.on('data', (c: Buffer) => {
        out += c.toString()
        const m = out.match(/http:\/\/\S+\//)
        if (m) {
          clearTimeout(t)
          resolve(m[0])
        }
      })
    })
    try {
      await use({
        url,
        dir,
        root,
        app,
        stderr: () => err,
        serverPid: server.pid!,
        scriptAgent: (s) => writeFileSync(scriptPath, JSON.stringify(s)),
        launches: () => jsonLines(launchLog),
      })
    } finally {
      server.kill('SIGKILL')
      rmSync(root, { recursive: true, force: true })
      app.remove()
    }
  },
})
export { expect }
