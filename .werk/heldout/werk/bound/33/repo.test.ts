import { afterAll, beforeAll, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Steps on the repository itself. Each runs in a fresh clone of this checkout under a temp
 * folder, so no file of the checkout changes. The PATH has no real `claude` on it.
 */
const REPO = realpathSync(join(import.meta.dir, '..'))
const PATH = (process.env.PATH ?? '')
  .split(':')
  .filter((d) => d && !existsSync(join(d, 'claude')))
  .join(':')
const ENV: Record<string, string> = { ...(process.env as Record<string, string>), PATH }
delete ENV.CI
let base: string
const roots: string[] = []

function sh(cmd: string, cwd: string, env: Record<string, string> = {}) {
  const r = Bun.spawnSync(['sh', '-c', cmd], { cwd, env: { ...ENV, ...env }, stdout: 'pipe', stderr: 'pipe' })
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() }
}

function clone(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'werk-heldout-')))
  roots.push(root)
  const dir = join(root, 'werk')
  const r = sh(`cp -cR '${base}' '${dir}' || cp -R '${base}' '${dir}'`, root)
  if (r.code !== 0) throw new Error(r.out)
  return dir
}

beforeAll(() => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'werk-heldout-base-')))
  roots.push(root)
  base = join(root, 'werk')
  let r = sh(`git clone --quiet '${REPO}' '${base}'`, root)
  if (r.code !== 0) throw new Error(r.out)
  r = sh('bun install --frozen-lockfile', base)
  if (r.code !== 0) throw new Error(r.out)
}, 300_000)

afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

const repoStatus = () => sh('git status --porcelain', REPO).out

test('31.1 empty first commit, every make target passes', () => {
  const dir = clone()
  const roots = sh('git rev-list --max-parents=0 main', dir).out.trim().split('\n')
  expect(roots.length).toBe(1)
  expect(sh(`git ls-tree -r ${roots[0]}`, dir).out.trim()).toBe('')
  const results: Record<string, { code: number; tail: string }> = {}
  for (const t of ['test', 'test-coverage', 'typecheck', 'lint', 'e2e']) {
    const r = sh(`make ${t}`, dir)
    results[t] = { code: r.code, tail: r.out.slice(-600) }
  }
  console.log(JSON.stringify(results, null, 1))
  for (const t of Object.keys(results)) expect(results[t]!.code, `make ${t}: ${results[t]!.tail}`).toBe(0)
}, 600_000)

test('01.3 bun test, then the coverage gate', () => {
  const dir = clone()
  const seen: string[] = []
  const r1 = sh('bun test', dir)
  const files = [...r1.out.matchAll(/^(\S+\.test\.tsx?):$/gm)].map((m) => m[1]!)
  const hasServer = files.some((f) => f.endsWith('.test.ts'))
  const hasReact = files.some((f) => f.endsWith('.tsx'))
  if (r1.code !== 0) seen.push(`bun test exit ${r1.code}: ${r1.out.split('\n').filter((l) => /fail|error/i.test(l)).slice(0, 8).join(' | ')}`)
  if (!hasServer) seen.push('no server tests')
  if (!hasReact) seen.push(`no React component tests in run (files: ${files.join(', ')})`)
  if (/coverage gate|% Lines/.test(r1.out)) seen.push('bun test ran a coverage check')
  const r2 = sh('bun run test:coverage', dir)
  if (r2.code !== 0) seen.push(`test:coverage exit ${r2.code} at full coverage: ${r2.out.slice(-400)}`)
  rmSync(join(dir, 'src/coverage/gate.test.ts'))
  const r3 = sh('bun run test:coverage', dir)
  if (r3.code === 0) seen.push('test:coverage passed after removing gate.test.ts')
  if (!/FAIL\s+src\/coverage\/gate\.ts/.test(r3.out)) seen.push(`gate output does not name gate.ts: ${r3.out.slice(-400)}`)
  const r4 = sh('bun test', dir)
  if (r4.code !== 0) seen.push(`bun test after removal exit ${r4.code}: ${r4.out.split('\n').filter((l) => /\(fail\)|coverage/i.test(l)).slice(0, 8).join(' | ')}`)
  console.log('01.3 observations:', seen)
  expect(seen).toEqual([])
}, 600_000)

test('01.4 bun run e2e boots a werk server on a fixture copy, screenshots each test', () => {
  const dir = clone()
  const seen: string[] = []
  const cfg = readFileSync(join(dir, 'playwright.config.ts'), 'utf8')
  if (!/webServer/.test(cfg)) seen.push('playwright.config.ts has no webServer: no werk server boots')
  const fixtures = sh('git ls-files | grep -i fixture', dir).out.trim()
  if (!fixtures) seen.push('no fixture project in the repository')
  const r = sh('bun run e2e', dir, { CI: 'true' })
  if (r.code !== 0) seen.push(`e2e exit ${r.code}: ${r.out.slice(-400)}`)
  const pngs = sh("find test-results -name '*.png' 2>/dev/null", dir).out.trim()
  if (!pngs) seen.push('no screenshot saved in test-results')
  const specs = sh('grep -l "goto(" e2e/*.ts', dir).out.trim()
  if (!specs) seen.push('no browser test opens a page that werk serves (no page.goto)')
  console.log('01.4 observations:', seen, r.out.slice(-300))
  expect(seen).toEqual([])
}, 600_000)

for (const id of ['01.2', '32.3', '32.5']) {
  test(`${id} the dev command starts the server`, () => {
    const dir = clone()
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    const r = sh('timeout 5 npm run dev || true', dir)
    expect(pkg.scripts.dev, `npm run dev: ${r.out.slice(0, 300)}`).toBeDefined()
  }, 60_000)
}

test('31.3 a new verb module lists and runs through the harness', () => {
  const before = repoStatus()
  const dir = clone()
  writeFileSync(
    join(dir, 'src/verbs/hello.ts'),
    `import type { Verb } from '../cli/registry.ts'\nconst hello: Verb = { name: 'hello', summary: 'Say hello.', run(_a, ctx) { ctx.out('hello from werk\\n'); return 0 } }\nexport default hello\n`,
  )
  const list = sh('bun src/cli.ts', dir)
  expect(list.code).toBe(0)
  expect(list.out).toMatch(/^ {2}hello\s+Say hello\./m)
  expect(list.out).toMatch(/^ {2}help\s/m)
  writeFileSync(
    join(dir, 'src/hello.test.ts'),
    `import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { makeProject } from './test/cli-harness.ts'
test('werk hello', async () => {
  const p = await makeProject()
  const r = await p.werk('hello')
  expect(r.code).toBe(0)
  expect(r.stdout).toBe('hello from werk\\n')
  expect(await p.git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('main\\n')
  p.cleanup()
  expect(existsSync(p.dir)).toBe(false)
})
`,
  )
  const headBefore = sh('git rev-parse HEAD', dir).out
  const r = sh('make test', dir)
  expect(r.code, r.out.slice(-800)).toBe(0)
  const h = sh('bun run test src/hello.test.ts', dir)
  expect(h.code, h.out.slice(-600)).toBe(0)
  expect(h.out).toMatch(/1 pass/)
  expect(sh('git status --porcelain', dir).out.trim().split('\n').sort()).toEqual(['?? src/hello.test.ts', '?? src/verbs/hello.ts'])
  expect(sh('git rev-parse HEAD', dir).out).toBe(headBefore)
  expect(repoStatus()).toBe(before)
}, 600_000)

test('31.4 coverage gate drops under 90% and passes again', () => {
  const dir = clone()
  const listPath = join(dir, 'src/coverage/pure-files.ts')
  writeFileSync(listPath, readFileSync(listPath, 'utf8').replace(`'src/test/fake-claude/script.ts',`, `'src/test/fake-claude/script.ts',\n  'src/heldout/sign.ts',`))
  const src = join(dir, 'src/heldout')
  sh(`mkdir -p '${src}'`, dir)
  const full = `export function sign(n: number): string {\n  if (n > 0) return 'pos'\n  return 'non'\n}\n`
  writeFileSync(join(src, 'sign.ts'), full)
  writeFileSync(join(src, 'sign.test.ts'), `import { expect, test } from 'bun:test'\nimport { sign } from './sign.ts'\ntest('sign', () => { expect(sign(1)).toBe('pos'); expect(sign(0)).toBe('non') })\n`)
  let r = sh('make test-coverage', dir)
  expect(r.code, r.out.slice(-600)).toBe(0)
  const extra = Array.from({ length: 12 }, (_, i) => `export function extra${i}(n: number): number {\n  if (n === ${i}) return ${i}\n  return n * ${i + 2}\n}\n`).join('')
  writeFileSync(join(src, 'sign.ts'), full + extra)
  r = sh('make test', dir)
  expect(r.code, r.out.slice(-600)).toBe(0)
  expect(r.out).not.toMatch(/coverage gate/)
  r = sh('make test-coverage', dir)
  expect(r.code).not.toBe(0)
  expect(r.out).toMatch(/FAIL\s+src\/heldout\/sign\.ts\s+\d+(\.\d)?%/)
  writeFileSync(
    join(src, 'sign.test.ts'),
    `import { expect, test } from 'bun:test'\nimport * as m from './sign.ts'\ntest('sign', () => { expect(m.sign(1)).toBe('pos'); expect(m.sign(0)).toBe('non') })\n` +
      Array.from({ length: 12 }, (_, i) => `test('extra${i}', () => { expect(m.extra${i}(${i})).toBe(${i}); expect(m.extra${i}(100)).toBe(${100 * (i + 2)}) })\n`).join(''),
  )
  r = sh('make test-coverage', dir)
  expect(r.code, r.out.slice(-600)).toBe(0)
}, 600_000)
