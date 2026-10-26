/** Held-out steps 61.1 to 61.4: a fresh clone of werk and its make targets. */
import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHECKOUT = join(import.meta.dir, '..', '..')
const LONG = 30 * 60_000
// The run's home is a fresh folder, so the browsers come from the machine's cache.
const BROWSERS = '/Users/eryk.napierala/Library/Caches/ms-playwright'

type R = { code: number; out: string }

function cloneRepo(): { dir: string; run: (cmd: string[], env?: Record<string, string>) => R; done: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'werk-heldout-clone-'))
  const dir = join(root, 'werk')
  const c = Bun.spawnSync(['git', 'clone', '--quiet', CHECKOUT, dir], { stdout: 'pipe', stderr: 'pipe' })
  if (c.exitCode !== 0) throw new Error(`clone failed: ${c.stderr.toString()}`)
  const run = (cmd: string[], env?: Record<string, string>): R => {
    const p = Bun.spawnSync(cmd, { cwd: dir, env: { PLAYWRIGHT_BROWSERS_PATH: BROWSERS, ...(env ?? process.env) }, stdout: 'pipe', stderr: 'pipe' })
    return { code: p.exitCode ?? -1, out: p.stdout.toString() + p.stderr.toString() }
  }
  return { dir, run, done: () => rmSync(root, { recursive: true, force: true }) }
}

const verbsOf = (help: string) =>
  help
    .split('\n')
    .map((l) => l.match(/^ {2}([a-z][a-z0-9-]*)\s/)?.[1])
    .filter((v): v is string => v !== undefined)

test(
  '61.1 a fresh clone builds on an empty first commit and passes every check',
  () => {
    const c = cloneRepo()
    try {
      const roots = c.run(['git', 'rev-list', '--max-parents=0', 'origin/main']).out.trim().split('\n')
      expect(roots).toHaveLength(1)
      const first = roots[0]!
      expect(c.run(['git', 'ls-tree', '-r', '--name-only', first]).out.trim()).toBe('')
      const all = c.run(['git', 'rev-list', 'origin/main']).out.trim().split('\n')
      for (const commit of all) expect(c.run(['git', 'merge-base', '--is-ancestor', first, commit]).code).toBe(0)
      const results: Record<string, R> = {}
      for (const target of ['test', 'test-coverage', 'typecheck', 'lint', 'e2e']) results[target] = c.run(['make', target])
      const failed = Object.entries(results)
        .filter(([, r]) => r.code !== 0)
        .map(([t, r]) => `${t} exited ${r.code}: ${r.out.slice(-3000)}`)
      expect(failed).toEqual([])
    } finally {
      c.done()
    }
  },
  LONG,
)

test(
  '61.2 help lists every registered verb, and a new ping module appears with no other edit',
  () => {
    const c = cloneRepo()
    try {
      expect(c.run(['bun', 'install', '--frozen-lockfile']).code).toBe(0)
      const before = c.run(['bun', 'src/cli/main.ts', 'help'])
      expect(before.code).toBe(0)
      const verbs = verbsOf(before.out)
      const modules = readdirSync(join(c.dir, 'src/cli/verbs')).filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f))
      expect(verbs).toContain('help')
      expect(verbs.length).toBe(modules.length)
      writeFileSync(
        join(c.dir, 'src/cli/verbs/ping.ts'),
        "import { registry } from '../registry.ts'\n\nregistry.register({\n  name: 'ping',\n  summary: 'answer pong',\n  run(_args, io) {\n    io.out('pong')\n    return 0\n  },\n})\n",
      )
      const after = c.run(['bun', 'src/cli/main.ts', 'help'])
      expect(after.code).toBe(0)
      const verbsAfter = verbsOf(after.out)
      expect(verbsAfter).toContain('ping')
      for (const v of verbs) expect(verbsAfter).toContain(v)
      expect(c.run(['git', 'status', '--porcelain']).out.trim()).toBe('?? src/cli/verbs/ping.ts')
    } finally {
      c.done()
    }
  },
  LONG,
)

/** PATH with every folder that holds a `claude` replaced by a copy of links to everything else. */
function pathWithoutClaude(root: string): string {
  return (process.env.PATH ?? '')
    .split(':')
    .filter(Boolean)
    .map((d, i) => {
      if (!existsSync(join(d, 'claude'))) return d
      const shadow = join(root, `shadow-${i}`)
      mkdirSync(shadow, { recursive: true })
      for (const f of readdirSync(d)) if (f !== 'claude') symlinkSync(join(d, f), join(shadow, f))
      return shadow
    })
    .join(':')
}

test(
  '61.3 the tests pass on a machine with no real agent installed',
  () => {
    const c = cloneRepo()
    const shadowRoot = mkdtempSync(join(tmpdir(), 'werk-heldout-path-'))
    try {
      const PATH = pathWithoutClaude(shadowRoot)
      const env = { ...process.env, PATH } as Record<string, string>
      expect(Bun.spawnSync(['sh', '-c', 'command -v claude'], { env }).exitCode).not.toBe(0)
      const r = c.run(['make', 'test'], env)
      if (r.code !== 0) console.error(r.out.slice(-4000))
      expect(r.code).toBe(0)
      // The command-line tests script the fake agent with events and an edit in a temporary project.
      const grep = c.run(['grep', '-rlE', 'edit: \\{ path', 'src/cli', 'src/test'])
      expect(grep.out.trim()).not.toBe('')
      expect(c.run(['git', 'status', '--porcelain']).out.trim()).toBe('')
    } finally {
      c.done()
      rmSync(shadowRoot, { recursive: true, force: true })
    }
  },
  LONG,
)

test(
  '61.4 the coverage gate fails below 90% on a pure file and passes again at 90% or above',
  () => {
    const c = cloneRepo()
    try {
      const base = c.run(['make', 'test-coverage'])
      if (base.code !== 0) console.error(base.out.slice(-3000))
      expect(base.code).toBe(0)
      rmSync(join(c.dir, 'src/markdown/escape.test.ts'))
      const plain = c.run(['make', 'test'])
      expect(plain.code).toBe(0)
      const cov = c.run(['make', 'test-coverage'])
      expect(cov.code).not.toBe(0)
      expect(cov.out).toMatch(/FAIL\s+\d+\.\d%\s+src\/markdown\/escape\.ts/)
      expect(c.run(['git', 'checkout', '--', 'src/markdown/escape.test.ts']).code).toBe(0)
      const again = c.run(['make', 'test-coverage'])
      expect(again.code).toBe(0)
    } finally {
      c.done()
    }
  },
  LONG,
)
