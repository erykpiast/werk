/** 82.1 last line: the person accepts each ghost from the plan with the ✓ button. */
import { test, expect } from '@playwright/test'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const MAIN = join(ROOT, 'src', 'cli', 'main.ts')
const FAKE_AGENT = join(ROOT, 'src', 'test', 'fake-agent.ts')
const PLAN = '.werk/plans/auth'

const ticket = (title: string, cites: string, blockedBy: string, stories: string) =>
  [`title: ${title}`, `cites: ${cites}`, `blocked_by: ${blockedBy}`, `stories: ${stories}`, 'touches: session store', '',
    '## What to build', '', `A person can ${title}.`, '', '## Acceptance criteria', '', '- [ ] It works.', '', '## Checks', '', '- `make test`', ''].join('\n')
const spec = '# Spec\n\n## User Stories\n\n1. One.\n2. Two.\n3. Three.\n'
const answer = (slug: string) => ({ slug, title: `Title ${slug}`, why: `Why ${slug}?`, body: `Body of ${slug}.` })
const edit = (path: string, content: string) => ({ edit: { path, content } })

test('82.1 the person accepts each plan ghost one at a time with the ✓ button', async ({ page }) => {
  const root = mkdtempSync(join(tmpdir(), 's80-e2e-'))
  const dir = join(root, 'project')
  const bin = join(root, 'bin')
  mkdirSync(join(dir, '.werk'), { recursive: true })
  mkdirSync(bin)
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\nexec bun ${JSON.stringify(FAKE_AGENT)} "$@"\n`)
  chmodSync(join(bin, 'claude'), 0o755)
  const at = '2026-10-21T00:00:00.000Z'
  const log = [
    { type: 'node.proposed', payload: { id: 'auth', kind: 'card', title: 'Auth', status: 'decided', who: 'you' } },
    { type: 'node.proposed', payload: { id: 'auth-session', kind: 'card', title: 'Session', status: 'decided', parent: 'auth' } },
    { type: 'node.accepted', payload: { id: 'auth-session' } },
  ].map((e, i) => JSON.stringify({ actor: 'agent', ...e, seq: i + 1, at }))
  writeFileSync(join(dir, '.werk', 'log.jsonl'), log.join('\n') + '\n')
  writeFileSync(join(root, 'agent-script.json'), JSON.stringify({
    steps: [],
    roles: {
      'spec-writer': { steps: [edit(`${PLAN}/spec.md`, spec), edit(`${PLAN}/spec.answers.json`, JSON.stringify([answer('token-ttl')]))] },
      'ticket-writer': { steps: [
        edit(`${PLAN}/tickets/01-login.md`, ticket('login', 'auth, auth-session', '', '1, 2')),
        edit(`${PLAN}/tickets/02-logout.md`, ticket('logout', 'auth', '1', '3')),
        edit(`${PLAN}/tickets.answers.json`, JSON.stringify([answer('split-login')])),
      ] },
    },
  }))
  const env = { PATH: `${bin}:${process.env.PATH ?? ''}`, HOME: root, TMPDIR: tmpdir(), GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null', WERK_FAKE_AGENT_SCRIPT: join(root, 'agent-script.json') }
  const run = (cmd: string, args: string[]) => spawnSync(cmd, args, { cwd: dir, env, encoding: 'utf8' })
  run('git', ['init', '--quiet', '--initial-branch=main'])
  run('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'commit', '--quiet', '--allow-empty', '-m', 'start'])
  const plan = run('bun', [MAIN, 'plan', 'auth'])
  expect(plan.status, plan.stdout + plan.stderr).toBe(0)

  const server = spawn('bun', [MAIN, 'serve', '--port', '0'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let out = ''
      const timer = setTimeout(() => reject(new Error('no address')), 20_000)
      server.stdout.on('data', (c: Buffer) => {
        out += c.toString()
        const m = out.match(/http:\/\/\S+\//)
        if (m) { clearTimeout(timer); resolve(m[0]) }
      })
    })
    const accepts = () => readFileSync(join(dir, '.werk', 'log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
      .filter((e) => e.type === 'node.accepted')
    for (const id of ['auth-token-ttl', 'auth-split-login']) {
      await page.goto(`${url}#${id}`)
      const detail = page.getByTestId('card')
      await expect(detail).toHaveAttribute('data-card-id', id)
      await expect(detail).toHaveAttribute('data-proposed', 'true')
      const before = accepts().length
      await page.getByRole('button', { name: `Accept #${id}` }).click()
      await expect(detail).toHaveAttribute('data-proposed', 'false')
      const after = accepts()
      expect(after.length).toBe(before + 1)
      expect(after.at(-1)).toMatchObject({ actor: 'you', payload: { id } })
    }
    await page.screenshot({ path: test.info().outputPath('evidence.png'), fullPage: true })
  } finally {
    server.kill('SIGTERM')
    rmSync(root, { recursive: true, force: true })
  }
})
