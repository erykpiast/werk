import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { copyRepo } from './copy.ts'

function hashTree(dir: string): string {
  const h = createHash('sha256')
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name)
      if (statSync(p).isDirectory()) walk(p)
      else h.update(p.slice(dir.length) + '\0' + readFileSync(p))
    }
  }
  walk(dir)
  return h.digest('hex')
}

test('01.4 bun run e2e boots a real server on a fixture copy and saves one PNG per test, with no real agent', () => {
  const repo = copyRepo()
  try {
    const fixture = join(repo, 'e2e', 'fixtures', 'demo')
    const before = hashTree(fixture)
    // No real agent: a trap `claude` sits on PATH behind everything else and records any call.
    const trapDir = join(repo, '.trap')
    mkdirSync(trapDir)
    const trapLog = join(repo, 'trap-called')
    writeFileSync(join(trapDir, 'claude'), `#!/bin/sh\necho called >> '${trapLog}'\nexit 1\n`)
    chmodSync(join(trapDir, 'claude'), 0o755)
    const env = { ...process.env, PATH: `${trapDir}:${process.env.PATH}`, WERK_E2E_PORT: '4977' } as Record<string, string>
    delete env.ANTHROPIC_API_KEY
    const r = spawnSync('bun', ['run', 'e2e'], { cwd: repo, env, encoding: 'utf8', timeout: 400_000 })
    const out = (r.stdout ?? '') + (r.stderr ?? '')
    console.log(out.split('\n').slice(-25).join('\n'))
    expect(r.status).toBe(0)
    const passed = Number(out.match(/(\d+) passed/)?.[1] ?? 0)
    expect(passed).toBeGreaterThan(0)
    // The server it booted serves a copy, not the fixture itself.
    expect(hashTree(fixture)).toBe(before)
    // Each spec opens the page werk serves.
    for (const spec of readdirSync(join(repo, 'e2e')).filter((f) => f.endsWith('.e2e.ts'))) {
      const text = readFileSync(join(repo, 'e2e', spec), 'utf8')
      const tests = text.match(/^test\(/gm)?.length ?? 0
      const gotos = text.match(/page\.goto\(/g)?.length ?? 0
      expect(gotos).toBeGreaterThanOrEqual(tests)
    }
    const evidence = join(repo, 'e2e', 'evidence')
    const pngs = existsSync(evidence) ? readdirSync(evidence).filter((f) => f.endsWith('.png')) : []
    console.log('evidence:', pngs)
    expect(pngs.length).toBe(passed)
    expect(existsSync(trapLog)).toBe(false)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
}, 600_000)
