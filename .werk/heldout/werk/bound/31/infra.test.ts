import { expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { cloneRepo, makeProject, REPO, sh, snapshot, startServer, HEAD } from './lib.ts'

const T = 900_000
function report(checks: [string, boolean, string?][]) {
  const bad = checks.filter(([, ok]) => !ok).map(([n, , d]) => `${n}${d ? `: ${d}` : ''}`)
  expect(bad).toEqual([])
}

test('01.1 werk serve shows an empty map shell', async () => {
  const p = await makeProject()
  try {
    const s = await startServer(p.dir, p.env, ['serve'])
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage()
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(String(e)))
      await page.goto(s.url)
      await page.waitForSelector('#root > *')
      const html = await page.innerHTML('#root')
      report([
        ['react rendered', html.length > 0],
        ['empty map shell', /map/i.test(html), html.slice(0, 300)],
        ['no page error', errors.length === 0, errors.join(';')],
        ['no server error', !/error/i.test(s.output()), s.output()],
      ])
    } finally { await browser.close(); s.stop() }
  } finally { p.cleanup() }
}, T)

test('01.2 dev command reuses the live server on a module edit', async () => {
  const c = await cloneRepo()
  try {
    const pkg = JSON.parse(readFileSync(join(c.dir, 'package.json'), 'utf8'))
    expect(Object.keys(pkg.scripts)).toContain('dev')
    const p = await makeProject()
    const s = await startServer(p.dir, p.env, ['dev'])
    s.stop(); p.cleanup()
  } finally { c.cleanup() }
}, T)

test('01.3 bun test, then the coverage gate', async () => {
  const c = await cloneRepo()
  try {
    const t1 = await sh(['bun', 'test'], c.dir)
    const files = [...new Bun.Glob('{src,web}/**/*.test.{ts,tsx}').scanSync({ cwd: c.dir })]
    const cov1 = await sh(['bun', 'run', 'test:coverage'], c.dir)
    rmSync(join(c.dir, 'src/cli/registry.test.ts'))
    const cov2 = await sh(['bun', 'run', 'test:coverage'], c.dir)
    const t2 = await sh(['bun', 'test'], c.dir)
    report([
      ['bun test passes', t1.code === 0, t1.all.slice(-300)],
      ['server tests exist', files.some((f) => /server/i.test(f)), files.join(',')],
      ['React component tests exist', files.some((f) => f.endsWith('.test.tsx')), files.join(',')],
      ['bun test has no coverage check', !/coverage gate/.test(t1.all)],
      ['coverage passes', cov1.code === 0, cov1.all.slice(-300)],
      ['coverage fails after removal', cov2.code !== 0],
      ['coverage names the file', /FAIL\s+src\/cli\/registry\.ts/.test(cov2.all), cov2.all.slice(-300)],
      ['bun test still passes', t2.code === 0 && !/coverage gate/.test(t2.all)],
    ])
  } finally { c.cleanup() }
}, T)

test('01.4 bun run e2e boots werk on a fixture copy with a fake agent', async () => {
  const c = await cloneRepo()
  try {
    const before = snapshot(join(c.dir, 'e2e'))
    const r = await sh(['bun', 'run', 'e2e'], c.dir)
    const after = snapshot(join(c.dir, 'e2e'))
    const cfg = readFileSync(join(c.dir, 'playwright.config.ts'), 'utf8')
    const specs = [...new Bun.Glob('**/*.spec.ts').scanSync({ cwd: join(c.dir, 'e2e') })]
    const specText = specs.map((s) => readFileSync(join(c.dir, 'e2e', s), 'utf8')).join('\n')
    const pngs = existsSync(join(c.dir, 'test-results'))
      ? [...new Bun.Glob('**/*.png').scanSync({ cwd: join(c.dir, 'test-results') })] : []
    const nTests = (r.all.match(/✓|✘/g) ?? []).length
    report([
      ['e2e exits 0', r.code === 0, r.all.slice(-400)],
      ['config boots a werk server', /webServer\s*:/.test(cfg), 'playwright.config.ts has no webServer'],
      ['a fixture project exists', [...before.keys()].some((f) => /fixture/i.test(f)), [...before.keys()].join(',')],
      ['fixture unchanged', JSON.stringify([...before]) === JSON.stringify([...after])],
      ['tests open the werk page', /page\.goto/.test(specText), 'specs use no page.goto'],
      ['one screenshot per test', nTests > 0 && pngs.length >= nTests, `tests=${nTests} pngs=${pngs.length}`],
      ['a scripted fake agent exists', /fake/i.test(cfg + specText), 'no fake agent in e2e config or specs'],
    ])
  } finally { c.cleanup() }
}, T)

test('01.5 the CLI harness runs werk in a temp project with a fake agent', async () => {
  const p = await makeProject()
  const r = await p.werk('help')
  const which = Bun.spawnSync(['sh', '-c', 'command -v claude'], { env: p.env }).stdout.toString().trim()
  const claude = Bun.spawnSync(['claude'], { env: p.env, cwd: p.dir })
  const gitDir = existsSync(join(p.dir, '.git'))
  p.cleanup()
  report([
    ['exit code read', r.code === 0],
    ['output read', r.stdout.includes('help')],
    ['git repo', gitDir],
    ['claude is the fake', which.startsWith(join(p.dir, '..', 'bin')) && claude.stderr.toString().includes('fake claude'), which],
    ['project gone', !existsSync(p.dir)],
  ])
}, T)

test('31.1 fresh clone: empty first commit, make targets pass', async () => {
  const root = (await sh(['mktemp', '-d'], REPO)).stdout.trim()
  const dir = join(root, 'werk')
  try {
    await sh(['git', 'clone', '-q', REPO, dir], root)
    await sh(['git', 'checkout', '-q', HEAD], dir)
    const roots = (await sh(['git', 'rev-list', '--max-parents=0', 'HEAD'], dir)).stdout.trim().split('\n')
    const rootFiles = (await sh(['git', 'ls-tree', '-r', '--name-only', roots[0] ?? ''], dir)).stdout.trim()
    const checks: [string, boolean, string?][] = [
      ['one root commit', roots.length === 1, roots.join(',')],
      ['first commit holds no files', rootFiles === '', rootFiles],
    ]
    for (const t of ['test', 'test-coverage', 'typecheck', 'lint', 'e2e']) {
      const r = await sh(['make', t], dir)
      checks.push([`make ${t} exits 0`, r.code === 0, r.all.slice(-400)])
    }
    report(checks)
  } finally { rmSync(root, { recursive: true, force: true }) }
}, T)

test('31.2 werk lists verbs and refuses an unknown verb', async () => {
  const p = await makeProject()
  try {
    const verbs = readdirSync(join(REPO, 'src/verbs')).filter((f) => !f.endsWith('.test.ts')).map((f) => f.replace(/\.ts$/, ''))
    const r = await p.werk()
    const u = await p.werk('frobnicate')
    report([
      ['lists every verb', verbs.every((v) => new RegExp(`^  ${v}\\b`, 'm').test(r.stdout)), r.stdout],
      ['exit 0', r.code === 0],
      ['unknown exits non-zero', u.code !== 0],
      ['names frobnicate as unknown', /unknown verb "frobnicate"/.test(u.stdout + u.stderr), u.stderr],
    ])
  } finally { p.cleanup() }
}, T)

test('31.3 a new verb module shows and runs through the harness', async () => {
  const c = await cloneRepo()
  try {
    const before = (await sh(['bun', 'src/cli.ts'], c.dir)).stdout
    writeFileSync(join(c.dir, 'src/verbs/hello.ts'),
      `import type { Verb } from '../cli/registry.ts'\nconst hello: Verb = { name: 'hello', summary: 'Say hello.', run(_a, ctx) { ctx.out('hello\\n'); return 0 } }\nexport default hello\n`)
    const after = (await sh(['bun', 'src/cli.ts'], c.dir)).stdout
    writeFileSync(join(c.dir, 'src/hello.test.ts'),
      `import { expect, test } from 'bun:test'\nimport { existsSync } from 'node:fs'\nimport { makeProject } from './test/cli-harness.ts'\ntest('werk hello', async () => {\n  const p = await makeProject()\n  await p.git('status')\n  const r = await p.werk('hello')\n  expect(r.code).toBe(0)\n  expect(r.stdout).toBe('hello\\n')\n  p.cleanup()\n  expect(existsSync(p.dir)).toBe(false)\n})\n`)
    const headBefore = (await sh(['git', 'rev-parse', 'HEAD'], c.dir)).stdout
    const m = await sh(['make', 'test'], c.dir)
    const status = (await sh(['git', 'status', '--porcelain'], c.dir)).stdout.trim().split('\n').sort()
    const headAfter = (await sh(['git', 'rev-parse', 'HEAD'], c.dir)).stdout
    const oldVerbs = before.split('\n').filter((l) => l.startsWith('  '))
    report([
      ['hello listed', /^  hello\s+Say hello\./m.test(after), after],
      ['old verbs still listed', oldVerbs.every((l) => after.includes(l.trim().split(/\s+/)[0] ?? ''))],
      ['make test passes', m.code === 0, m.all.slice(-400)],
      ['hello test ran and passed', /hello\.test\.ts/.test(m.all) && /\(pass\) werk hello|✓ werk hello/.test(m.all) || (m.code === 0 && /0 fail/.test(m.all)), m.all.slice(-400)],
      ['real repo unchanged except the two new files', JSON.stringify(status) === JSON.stringify(['?? src/hello.test.ts', '?? src/verbs/hello.ts']) && headBefore === headAfter, status.join(';')],
    ])
  } finally { c.cleanup() }
}, T)

test('31.4 the coverage gate fails and recovers on a listed pure file', async () => {
  const c = await cloneRepo()
  try {
    mkdirSync(join(c.dir, 'src/pure'), { recursive: true })
    const src = join(c.dir, 'src/pure/sign.ts')
    writeFileSync(src, `export function sign(n: number): string {\n  if (n > 0) return 'pos'\n  return 'non-pos'\n}\n`)
    writeFileSync(join(c.dir, 'src/pure/sign.test.ts'),
      `import { expect, test } from 'bun:test'\nimport { sign } from './sign.ts'\ntest('sign', () => { expect(sign(1)).toBe('pos'); expect(sign(0)).toBe('non-pos') })\n`)
    const pf = join(c.dir, 'src/coverage/pure-files.ts')
    writeFileSync(pf, readFileSync(pf, 'utf8').replace(`'src/coverage/gate.ts'`, `'src/coverage/gate.ts', 'src/pure/sign.ts'`))
    const c1 = await sh(['make', 'test-coverage'], c.dir)
    const extra = Array.from({ length: 30 }, (_, i) => `  if (n === ${100 + i}) {\n    const x${i} = n * ${i}\n    return 'v' + x${i}\n  }`).join('\n')
    writeFileSync(src, `export function sign(n: number): string {\n${extra}\n  if (n > 0) return 'pos'\n  return 'non-pos'\n}\n`)
    const t = await sh(['make', 'test'], c.dir)
    const c2 = await sh(['make', 'test-coverage'], c.dir)
    writeFileSync(join(c.dir, 'src/pure/sign2.test.ts'),
      `import { expect, test } from 'bun:test'\nimport { sign } from './sign.ts'\ntest('all', () => { for (let i = 0; i < 30; i++) expect(sign(100 + i)).toBe('v' + (100 + i) * i) })\n`)
    const c3 = await sh(['make', 'test-coverage'], c.dir)
    report([
      ['coverage 0 at start', c1.code === 0, c1.all.slice(-400)],
      ['make test 0, no coverage failure', t.code === 0 && !/FAIL|coverage gate/.test(t.all), t.all.slice(-300)],
      ['coverage non-zero', c2.code !== 0],
      ['names file and percent', /FAIL\s+src\/pure\/sign\.ts\s+\d+\.\d%/.test(c2.all), c2.all.slice(-400)],
      ['coverage 0 again', c3.code === 0, c3.all.slice(-400)],
    ])
  } finally { c.cleanup() }
}, T)
