import { expect, test } from 'bun:test'
import { accessSync, constants, existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshClone, sh, tail } from './util.ts'

// 61.3
// Scenario: The tests pass on a machine with no real agent installed
// Given a person has a copy of the werk project with its dependencies installed
// And no `claude` program is installed or reachable on the PATH of the person's shell
// When the person runs `make test`
// Then `make test` exits with success
// And the tests that run the command line read the scripted events and the file edit of the fake agent from a temporary project
// And the working tree of the person's project has no new or changed files after the run
test('61.3', async () => {
  const dir = freshClone('s3')
  const install = sh(['bun', 'install', '--frozen-lockfile'], dir)
  expect(install.code, tail(install.out)).toBe(0)

  const hasClaude = (d: string) => {
    try {
      accessSync(join(d, 'claude'), constants.X_OK)
      return true
    } catch {
      return false
    }
  }
  const path = (process.env.PATH ?? '')
    .split(':')
    .filter((d) => d && d !== '.' && !hasClaude(d))
    .join(':')
  const tmp = mkdtempSync(join(tmpdir(), 'werk-61-s3-tmp-'))
  const env: Record<string, string> = { ...(process.env as Record<string, string>), PATH: path, TMPDIR: tmp }
  delete env.CI
  const which = sh(['/bin/sh', '-c', 'command -v claude'], dir, env)
  expect(which.code).not.toBe(0)
  expect(which.out.trim()).toBe('')

  const before = sh(['git', 'status', '--porcelain', '--untracked-files=all'], dir).out
  expect(before).toBe('')

  // Watch the temporary projects the tests make while `make test` runs.
  const seen = new Set<string>()
  let scriptsWithEvent = 0
  let scriptsWithEdit = 0
  const scanned = new Set<string>()
  const poll = setInterval(() => {
    for (const f of readdirSync(tmp)) {
      if (!f.startsWith('werk-project-')) continue
      seen.add(f)
      const script = join(tmp, f, 'agent-script.json')
      try {
        const s = readFileSync(script, 'utf8')
        const key = f + s
        if (scanned.has(key)) continue
        scanned.add(key)
        if (s.includes('"event"')) scriptsWithEvent++
        if (s.includes('"edit"')) scriptsWithEdit++
      } catch {}
    }
  }, 20)
  const p = Bun.spawn(['make', 'test'], { cwd: dir, env, stdout: 'pipe', stderr: 'pipe' })
  const [o, e, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
  clearInterval(poll)
  const after = sh(['git', 'status', '--porcelain', '--untracked-files=all'], dir).out
  console.log(`61.3: make test -> ${code}\n${tail(o + e, 1500)}`)
  console.log(`61.3: temp projects seen ${seen.size}, scripts with event ${scriptsWithEvent}, with edit ${scriptsWithEdit}`)
  console.log(`61.3: git status after: ${JSON.stringify(after)}`)
  console.log(`61.3: leftover in tmp: ${readdirSync(tmp).filter((f) => f.startsWith('werk-project-')).length}`)
  expect(code).toBe(0)
  expect(seen.size).toBeGreaterThan(0)
  expect(scriptsWithEvent).toBeGreaterThan(0)
  expect(scriptsWithEdit).toBeGreaterThan(0)
  expect(after).toBe('')
  expect(existsSync(join(dir, 'claude'))).toBe(false)
}, 1_200_000)
