import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const WT = join(import.meta.dir, '..')

const logState = (dir: string) => {
  const d = join(dir, '.werk')
  if (!existsSync(d)) return 'none'
  return readdirSync(d)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => `${f}:${readFileSync(join(d, f), 'utf8')}`)
    .join('\n')
}

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })

test(
  '69.5 make e2e runs the browser specs and leaves one screenshot per test',
  () => {
    const clone = join(mkdtempSync(join(tmpdir(), 's69-clone-')), 'werk')
    const c = spawnSync('git', ['clone', '--quiet', WT, clone], { encoding: 'utf8' })
    expect(c.status).toBe(0)
    const fixtureBefore = logState(join(clone, 'e2e', 'fixture-project'))
    const cloneBefore = logState(clone)
    const wtBefore = logState(WT)
    const env = { ...process.env }
    delete env.WERK_LOG
    const r = spawnSync('make', ['e2e'], { cwd: clone, env, encoding: 'utf8', timeout: 900_000 })
    const out = r.stdout + r.stderr
    console.log(out.slice(-4000))
    const ran = [...out.matchAll(/^\s*[✓✘-]\s+\d+ \[chromium\] › (\S+?):\d+:\d+ › (.+?)(?: \(\d.*\))?$/gm)]
    console.log(`tests reported: ${ran.length}, exit ${r.status}`)
    expect(ran.length).toBeGreaterThan(0)
    const specs = new Set(ran.map((m) => m[1]))
    console.log('specs:', [...specs].join(', '))
    expect(specs.size).toBe(3)
    expect(out).toMatch(/\d+ passed/)
    const shots = walk(join(clone, 'test-results')).filter((p) => p.endsWith('.png'))
    console.log(`screenshots: ${shots.length}`)
    expect(shots.length).toBe(ran.length)
    expect(logState(join(clone, 'e2e', 'fixture-project'))).toBe(fixtureBefore)
    expect(logState(clone)).toBe(cloneBefore)
    expect(logState(WT)).toBe(wtBefore)
    console.log(`make e2e exit: ${r.status}`)
  },
  { timeout: 960_000 },
)
