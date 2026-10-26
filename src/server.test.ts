// server.ts behaviours from #werk-test-behaviours-server. Each runs against a real
// `werk serve` process on a scratch .werk, through real HTTP, with the fake claude on PATH.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { basename, join } from 'node:path'
import { launches, serveScratch, waitFor, type Served } from './test/harness.ts'

let s: Served

beforeAll(async () => {
  s = await serveScratch(4942)
})

afterAll(async () => {
  await s?.stop()
})

const post = (path: string, body: unknown, type = 'application/json') =>
  fetch(s.url + path, {
    method: 'POST',
    headers: { 'content-type': type },
    body: typeof body === 'string' ? body : body instanceof Uint8Array ? new Blob([body as Uint8Array<ArrayBuffer>]) : JSON.stringify(body),
  })

/** GET with the path sent exactly as written — fetch would normalise `..` away first. */
const raw = (path: string) =>
  new Promise<{ status: number; body: string; location?: string }>((resolve, reject) => {
    const req = request({ host: 'localhost', port: 4942, path, method: 'GET' }, (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, location: res.headers.location }))
    })
    req.on('error', reject)
    req.end()
  })

/** Every event on /api/live from now on, parsed. */
async function listen() {
  const events: Array<{ event: string; data: any }> = []
  const ctrl = new AbortController()
  const res = await fetch(s.url + '/api/live', { signal: ctrl.signal })
  const reader = res.body!.getReader()
  let buf = ''
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) return
        buf += new TextDecoder().decode(value)
        let at: number
        while ((at = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, at)
          buf = buf.slice(at + 2)
          const event = /^event: (.*)$/m.exec(frame)?.[1]
          const data = /^data: (.*)$/m.exec(frame)?.[1]
          if (event && data) events.push({ event, data: JSON.parse(data) })
        }
      }
    } catch {}
  })()
  return { events, close: () => ctrl.abort() }
}

describe('server.ts', () => {
  test('1. a second server on the same .werk refuses to start', async () => {
    const second = await serveScratch(4943, { dir: s.dir, wait: false })
    const code = await second.proc.exited
    expect(code).toBe(1)
    expect(second.out()).toContain('another werk is already serving this repository on port 4942')
    // The first one is untouched.
    expect((await fetch(s.url + '/api/graph')).status).toBe(200)
  }, 15000)

  test('2. upload takes png/jpeg/gif/webp only, and nothing over 20 MB', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    const ok = await post('/api/upload', png, 'image/png')
    expect(ok.status).toBe(200)
    expect((await ok.json()).name).toEndWith('.png')

    const svg = await post('/api/upload', '<svg/>', 'image/svg+xml')
    expect(svg.status).toBe(400)
    expect((await svg.json()).error).toContain('not "image/svg+xml"')

    const before = readdirSync(join(s.werk, 'attachments')).length
    // Over the cap the server destroys the request. A client sees a 400 or a dropped
    // connection, depending on timing — either way nothing is written.
    const huge = await post('/api/upload', new Uint8Array(21 * 1024 * 1024), 'image/png').then(
      (r) => r.status,
      () => 'dropped',
    )
    expect([400, 'dropped']).toContain(huge)
    expect(readdirSync(join(s.werk, 'attachments')).length).toBe(before)
  })

  test('3. /api/image serves only a file directly under attachments', async () => {
    writeFileSync(join(s.werk, 'attachments', 'pic.png'), 'PNGDATA')
    writeFileSync(join(s.werk, 'secret.png'), 'SECRET')
    expect(await (await fetch(`${s.url}/api/image?name=pic.png`)).text()).toBe('PNGDATA')
    for (const name of ['../secret.png', '..%2Fsecret.png', '/etc/hosts', `${s.werk}/secret.png`, '']) {
      const r = await fetch(`${s.url}/api/image?name=${name}`)
      expect(r.status).toBe(404)
      expect(await r.text()).not.toContain('SECRET')
    }
  })

  test('4. static files stay under web/, whatever the path', async () => {
    // #vi-routes: an address with no project opens the last project used.
    const home = await raw('/')
    expect(home.status).toBe(302)
    expect(home.location).toBe(`/p/${encodeURIComponent(basename(s.dir))}/map`)
    expect((await raw(home.location!)).body).toContain('<html')
    for (const path of ['/../package.json', '/../../etc/hosts', '/%2e%2e/package.json', '/..%2fpackage.json', '/../src/cli.ts', '//etc/hosts']) {
      const r = await raw(path)
      expect(r.status).toBe(404)
      expect(r.body).not.toContain('"devDependencies"')
    }
  })

  test('5. every pushed event carries the convo it belongs to', async () => {
    const live = await listen()
    expect((await post('/api/chat', { text: 'to main' })).status).toBe(200)
    await waitFor(() => live.events.some((e) => e.event === 'chat' && e.data.done), 'the main turn to finish')
    const fork = await (await post('/api/convo/fork', { from: 'main', atCard: 'card-x' })).json()
    expect(fork).toEqual({ ok: true, name: 'card-x' })
    expect((await post('/api/chat', { text: 'to the fork', convo: 'card-x' })).status).toBe(200)
    await waitFor(() => live.events.filter((e) => e.event === 'chat' && e.data.done).length === 2, 'the fork turn to finish')
    live.close()

    const tagged = live.events.filter((e) => ['chat', 'delta', 'status', 'context', 'background'].includes(e.event))
    expect(tagged.length).toBeGreaterThan(0)
    for (const e of tagged) expect(['main', 'card-x']).toContain(e.data.convo)
    const reply = (text: string) => live.events.find((e) => e.event === 'chat' && e.data.text === text)?.data.convo
    expect(reply('echo to main')).toBe('main')
    expect(reply('echo to the fork')).toBe('card-x')
    expect(live.events.find((e) => e.event === 'chat' && e.data.text === 'to the fork')!.data.convo).toBe('card-x')
  })

  test('6. /api/chat refuses a message with neither text nor images', async () => {
    const before = launches(s.log).length
    for (const body of [{}, { text: '   ' }, { text: '', images: [] }]) {
      const r = await post('/api/chat', body)
      expect(r.status).toBe(400)
      expect((await r.json()).error).toBe('a message needs text or an image')
    }
    expect(launches(s.log).length).toBe(before)
  })

  test('7. /api/model refuses a model or advisor outside the allow-list', async () => {
    const before = launches(s.log).length
    const bad = await post('/api/model', { model: 'claude-evil --dangerously-skip-permissions' })
    expect(bad.status).toBe(400)
    const badAdvisor = await post('/api/model', { model: 'claude-opus-5-5', advisor: 'x' })
    expect(badAdvisor.status).toBe(400)
    await Bun.sleep(300)
    const after = launches(s.log).slice(before)
    expect(after.flat().join(' ')).not.toContain('claude-evil')
    expect(after.flat()).not.toContain('x')
    const good = await post('/api/model', { model: 'claude-opus-5-5', advisor: null, convo: 'card-x' })
    expect(good.status).toBe(200)
  })

  test('8. the diagram ?style= is stripped to [a-zA-Z0-9-] before it names a file', async () => {
    mkdirSync(s.werk, { recursive: true })
    writeFileSync(join(s.werk, 'secret.svg'), 'LEAK')
    writeFileSync(join(s.werk, 'diagram-ok-1.svg'), '<svg>ok</svg>')
    writeFileSync(join(s.werk, 'diagram-ok-1.wgrid'), 'grid source')
    expect(await (await fetch(`${s.url}/api/diagram-svg?style=ok-1`)).text()).toBe('<svg>ok</svg>')
    expect(await (await fetch(`${s.url}/api/diagram-svg?style=../ok-1`)).text()).toBe('<svg>ok</svg>')
    expect(await (await fetch(`${s.url}/api/diagram-source?style=ok/-1`)).text()).toBe('grid source')
    for (const style of ['../secret', '..%2Fsecret', '/../../secret']) {
      expect(await (await fetch(`${s.url}/api/diagram-svg?style=${style}`)).text()).not.toContain('LEAK')
      expect(await (await fetch(`${s.url}/api/diagram-source?style=${style}`)).text()).not.toContain('LEAK')
    }
    expect(existsSync(join(s.werk, 'secret.svg'))).toBe(true)
  })
})
