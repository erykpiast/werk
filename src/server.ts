import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, watch, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { listSlashCommands } from './commands.ts'
import { toJSON } from './fold.ts'
import { foldLog, foldTimes } from './fold-time.ts'
import { cardFlows, chatWaits, probeCounts, rederives, type ChatWait, type ProbeCount, type Rederive } from './flow.ts'
import { nextPhrase } from '../web/md.js'
import { append, appendMany, readEvents } from './log.ts'
import { readSession } from './agent.ts'
import { ConvoManager, wholeMs } from './convo-manager.ts'
import { inProject, paths, projectRoot } from './project.ts'
import { AddRefusal, addProject, findProject, initGit, lastProject, listProjects, projectAt, removeProject, useProject, type Project } from './projects.ts'
import { amendRefusal, pendingChange } from './amend.ts'
import { acceptClosure, ancestorsOf, discardClosure, planRemoval } from './stage.ts'
import { WHAT } from './tops.ts'
import { convoTitle, describeConvoDisk, listConvos, MAIN } from './convos.ts'
import { boardRoutes } from './board-routes.ts'
import { foldBoard, readBoard } from './board.ts'
import { planBlockers } from './plan-tickets.ts'
import { readTicketText } from './board-files.ts'
import { measures, type Measures } from './measures.ts'
import { tokensOf, type Tokens } from './cost.ts'
import { readTestRuns } from './test-runs.ts'
import { readPipeline } from './pipeline.ts'
import { runClaudeAgent, runGridBuild, startSysdiagSync } from './sysdiag-sync.ts'
import type { Ask, Decision } from './permission.ts'

const lockPath = () => join(paths.werk, 'serve.lock')

/**
 * One server per .werk directory.
 *
 * Two servers share `session`, `chat.jsonl` and one conversation. They overwrite each
 * other's session id and interleave their transcripts, which looks exactly like the agent
 * losing its memory at random. Refusing to open the project is far cheaper than debugging
 * that. Runs inside the project's context, and throws when another server holds it.
 */
async function takeLock(port: number) {
  // The create fails when the file exists, so of two starts in the same moment only one
  // wins. A check followed by a write would let both find no lock. See #werk-onelock-take.
  //
  // A stopped-and-restarted server can start before the old process has finished dying.
  // Waiting a few seconds turns that race into a pause. A server that is really running is
  // still refused, only later. A hot-reloaded edit never reaches this function a second
  // time for the same project — see the guard at the top of serve().
  const LOCK_PATH = lockPath()
  mkdirSync(dirname(LOCK_PATH), { recursive: true })
  // #werk-onelock-take-lockfile: the lock names port 0 until the server listens.
  const lock = JSON.stringify({ pid: process.pid, port: 0, at: new Date().toISOString() })
  // #werk-onelock-take-wait: read the lock every tenth of a second, refuse after the wait.
  // WERK_LOCK_WAIT_MS changes the wait; a value that is not a whole number of ms is ignored.
  const waitMs = wholeMs(process.env.WERK_LOCK_WAIT_MS) ?? 5000
  const started = Date.now()
  for (let wait = 0; ; wait++) {
    try {
      writeFileSync(LOCK_PATH, lock, { flag: 'wx' })
      return
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
    const held = readLock(LOCK_PATH)
    if (held === 'gone') continue
    const last = Date.now() - started >= waitMs
    // A lock that does not parse may belong to a start between its create and its write.
    // Still unreadable after the whole wait, its holder died between the two.
    const stale = held === 'unreadable' ? last : !alive(held.pid) || held.pid === process.pid
    if (stale) {
      rmSync(LOCK_PATH, { force: true })
      continue
    }
    if (last && held !== 'unreadable') {
      throw new Error(`another werk is already serving this repository on port ${held.port || 'not known yet'} (pid ${held.pid}): ${projectRoot()}. Stop it first. One server per .werk.`)
    }
    if (wait === 0) console.log(`werk: waiting for ${held === 'unreadable' ? 'the lock to be written' : `pid ${held.pid} to let go of the lock`}`)
    await sleep(100)
  }
}

/** #werk-onelock-take-lockfile: once the server listens, the lock gets its real port. */
function fillLockPort(LOCK_PATH: string, port: number) {
  const held = readLock(LOCK_PATH)
  if (held === 'gone' || held === 'unreadable' || held.pid !== process.pid) return
  writeFileSync(LOCK_PATH, JSON.stringify({ ...held, port }))
}

function readLock(LOCK_PATH: string): { pid: number; port: number } | 'gone' | 'unreadable' {
  let text: string
  try {
    text = readFileSync(LOCK_PATH, 'utf8')
  } catch {
    return 'gone'
  }
  try {
    return JSON.parse(text)
  } catch {
    return 'unreadable'
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function releaseLock(LOCK_PATH: string) {
  try {
    const held = JSON.parse(readFileSync(LOCK_PATH, 'utf8'))
    if (held.pid === process.pid) rmSync(LOCK_PATH)
  } catch {
    // The lock is already gone, or was never ours. Nothing to release.
  }
}

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', 'web')

/** #ms-outcome-interv-chat: the hanging questions of every conversation, from the chat files,
 *  the ask history and the asks still open. A file is read again only when its size or time
 *  changes. */
const textMemo = new Map<string, { stamp: string; text: string }>()
function readText(path: string): string {
  try {
    const s = statSync(path)
    const stamp = `${s.size}:${s.mtimeMs}`
    let m = textMemo.get(path)
    if (m?.stamp !== stamp) textMemo.set(path, (m = { stamp, text: readFileSync(path, 'utf8') }))
    return m.text
  } catch {
    return ''
  }
}
/** #vi-flow-ms: the pipeline measures, folded again only when the pipeline log changes. A
 *  ticket's size is the count of stories in its file (#lp-trend-size). One memo per project. */
const measuresMemo = new Map<string, { text: string; m: Measures }>()
function readMeasures(): Measures {
  const board = readBoard()
  // The decision log is in the key too: a reopen of a cited card is rework (#ms-outcome-rework).
  const text = readText(paths.pipeline) + '\n' + board.length + ':' + (board.at(-1)?.seq ?? 0) + ':' + readText(paths.log).length
  const memo = measuresMemo.get(projectRoot())
  if (memo?.text === text) return memo.m
  const tickets = foldBoard(board).tickets
  const sizeOf = (id: string) => {
    const t = tickets.get(id)
    return t ? readTicketText(t)?.stories.length : undefined
  }
  const m = measures(readPipeline(), sizeOf, board, sessionTokens, readEvents())
  measuresMemo.set(projectRoot(), { text, m })
  return m
}

/** #vi-flow-ms-stage-unit: the tokens of a session event written before sessions recorded them,
 *  from the result event at the end of its transcript. A finished transcript does not change,
 *  so each is read once. */
const sessionTokensMemo = new Map<string, Tokens | undefined>()
function sessionTokens(file: string): Tokens | undefined {
  const path = join(projectRoot(), file)
  if (sessionTokensMemo.has(path)) return sessionTokensMemo.get(path)
  let tokens: Tokens | undefined
  try {
    const lines = readFileSync(path, 'utf8').trimEnd().split('\n')
    for (let i = lines.length - 1; i >= 0 && !tokens; i--) {
      if (!lines[i].includes('"type":"result"')) continue
      const usage = JSON.parse(lines[i]).usage
      if (usage) tokens = tokensOf(usage)
    }
  } catch {
    tokens = undefined
  }
  sessionTokensMemo.set(path, tokens)
  return tokens
}

function readChatWaits(pending: Ask[]): ChatWait[] {
  const chats = listConvos().map((c) => ({ convo: c.name, text: readText(c.chatPath) }))
  return chatWaits(chats, readText(paths.asks), nextPhrase, pending)
}

/** #lp-overseer-psfail-metric: the probe counts of every pass stream under the runs folder.
 *  A stream is read again only when its size or time changes. */
const probeMemo = new Map<string, { stamp: string; counts: ProbeCount[] }>()
function readProbeCounts(runsDir: string): ProbeCount[] {
  const out: ProbeCount[] = []
  let runs: string[]
  try {
    runs = readdirSync(runsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(runsDir, d.name))
  } catch {
    return out
  }
  for (const dir of runs) {
    let files: string[]
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const f of files) {
      const path = join(dir, f)
      try {
        const s = statSync(path)
        const stamp = `${s.size}:${s.mtimeMs}`
        let m = probeMemo.get(path)
        if (m?.stamp !== stamp) probeMemo.set(path, (m = { stamp, counts: probeCounts(readFileSync(path, 'utf8')) }))
        out.push(...m.counts)
      } catch {
        // A stream removed while it was read: it has no counts.
      }
    }
  }
  return out
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml; charset=utf-8',
}

const EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
}

/** Read a request body as raw bytes. Used for a pasted image. */
const readBytes = (req: IncomingMessage) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > 20 * 1024 * 1024) {
        reject(new Error('the image is larger than 20 MB'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })

const readBody = (req: IncomingMessage) =>
  new Promise<any>((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw))
      } catch (err) {
        reject(err)
      }
    })
  })

/** One project open in the server: its conversations, board, watchers and page streams
 *  (#werk-projects-one-process). Everything in it runs in the project's own context. */
type Opened = {
  project: Project
  /** Answers one request under the project's /api. False when no route matched. */
  handle: (req: IncomingMessage, res: ServerResponse, url: URL) => boolean | void
  push: (event: string, data: unknown) => void
  /** The conversations with a turn running now. */
  running: () => string[]
  /** Stop every conversation, every watcher and every stream, and let go of the lock. */
  close: () => void
}

type OpenOptions = { port: number; allow?: string[]; fresh: boolean; onBusy: () => void; listening: Promise<void> }

const send = (res: ServerResponse, status: number, body: unknown) => {
  if (!res.headersSent) res.writeHead(status, { 'content-type': MIME['.json'], 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

/** #werk-projects-add: the macOS folder dialog, on the machine the server runs on. Resolves
 *  to the chosen folder, or null when the person cancels. */
function pickFolder(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const script = 'POSIX path of (choose folder with prompt "Add a project to werk")'
    const child = spawn('osascript', ['-e', script])
    let out = ''
    let err = ''
    child.stdout.on('data', (c) => (out += c))
    child.stderr.on('data', (c) => (err += c))
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve(out.trim().replace(/\/$/, '') || null)
      // -128 is the dialog's Cancel.
      else if (err.includes('-128')) resolve(null)
      else reject(new Error(err.trim() || `the folder dialog exited with ${code}`))
    })
  })
}

export async function serve(port = 4000, allow?: string[], fresh = false, start?: string) {
  // bun --hot reloads this module's top level on every edit under src/. Without this guard
  // it would construct a second Agent and a second listener each time, orphaning whatever
  // the first one was doing. Pinned to globalThis so it survives the reload. See #werk-hmr.
  const g = globalThis as unknown as { __werkServe?: { port: number } }
  if (g.__werkServe && g.__werkServe.port === port) {
    console.log(`werk: hot-reloaded, reusing the live server on port ${port}`)
    return
  }
  g.__werkServe = { port }

  /** Every project opened since the server started, by root. A project opens on its first
   *  request and stays open, so its agents keep running out of view (#werk-projects-background). */
  let listenDone!: () => void
  const listening = new Promise<void>((r) => (listenDone = r))
  const opening = new Map<string, Promise<Opened>>()
  const live = new Map<string, Opened>()
  const pushAll = (event: string, data: unknown) => {
    for (const o of live.values()) o.push(event, data)
  }
  // The switcher's busy marks and the list itself: every page refetches the list.
  let projectsTimer: NodeJS.Timeout | undefined
  const projectsChanged = () => {
    clearTimeout(projectsTimer)
    projectsTimer = setTimeout(() => pushAll('projects', 1), 100)
  }

  const open = (p: Project, first = false): Promise<Opened> => {
    let o = opening.get(p.root)
    if (!o) {
      o = inProject(p.root, () => openProject(p, { port, allow, fresh: first && fresh, onBusy: projectsChanged, listening }))
      opening.set(p.root, o)
      o.then(
        (opened) => live.set(p.root, opened),
        (err) => {
          opening.delete(p.root)
          console.error(`werk: could not open ${p.root}: ${(err as Error).message}`)
        },
      )
    }
    return o
  }

  const close = (p: Project) => {
    live.get(p.root)?.close()
    live.delete(p.root)
    opening.delete(p.root)
  }

  // The project werk started in opens at once, so its conversation resumes as before.
  const first = start ? projectAt(start) : undefined
  if (first && !first.missing) {
    // open() has already said why it failed.
    await open(first, true).catch(() => process.exit(1))
  }

  /** #werk-projects-list, #werk-projects-add: the list and its changes. Outside every project. */
  async function projectRoutes(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (url.pathname === '/api/projects' && req.method !== 'POST') {
      const projects = listProjects().map((p) => ({ ...p, running: live.get(p.root)?.running() ?? [] }))
      return send(res, 200, { projects, home: homedir() })
    }
    if (req.method !== 'POST') return send(res, 404, { ok: false, error: 'not found' })
    const body = url.pathname === '/api/projects/pick' ? {} : await readBody(req)
    try {
      if (url.pathname === '/api/projects/pick') return send(res, 200, { ok: true, path: await pickFolder() })
      if (url.pathname === '/api/projects/add') {
        // The page asked first: the person agreed to a new git repository in the folder.
        if (body.init === true) initGit(String(body.root))
        const project = addProject(String(body.root ?? ''))
        projectsChanged()
        return send(res, 200, { ok: true, project })
      }
      if (url.pathname === '/api/projects/remove') {
        const p = findProject(String(body.name ?? ''))
        if (!p) throw new Error(`no project named "${body.name}"`)
        const running = live.get(p.root)?.running() ?? []
        // #werk-projects-list: a running turn is named, and stopped only once confirmed.
        if (running.length && body.force !== true) return send(res, 409, { ok: false, running })
        removeProject(p.name)
        close(p)
        projectsChanged()
        return send(res, 200, { ok: true })
      }
      return send(res, 404, { ok: false, error: 'not found' })
    } catch (err) {
      send(res, err instanceof AddRefusal ? 409 : 400, { ok: false, error: (err as Error).message, needsGit: err instanceof AddRefusal && err.needsGit })
    }
  }

  const indexHtml = (res: ServerResponse) => {
    res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' })
    res.end(readFileSync(join(WEB, 'index.html')))
  }

  // #vi-routes: every address starts with the project, /p/<name>. What follows is the view
  // and the card, or the project's /api. An address with no project opens the last one used.
  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname === '/api/projects' || url.pathname.startsWith('/api/projects/')) return projectRoutes(req, res, url)
    const m = /^\/p\/([^/]+)(\/.*)?$/.exec(url.pathname)
    const rest = m ? (m[2] ?? '/') : url.pathname
    const project = m ? findProject(decodeURIComponent(m[1])) : url.pathname.startsWith('/api/') ? lastProject() : undefined
    const isView = rest === '/' || /^\/(map|flow|measure|graph|diagram|board)(\/[^/]*)?$/.test(rest)

    if (rest.startsWith('/api/')) {
      if (!project) return send(res, 404, { ok: false, error: 'no such project' })
      if (project.missing) return send(res, 404, { ok: false, error: `the folder ${project.root} is missing` })
      const o = await open(project)
      url.pathname = rest
      if (inProject(project.root, () => o.handle(req, res, url)) === false) send(res, 404, { ok: false, error: 'not found' })
      return
    }
    if (m && isView) {
      // The page shows a project that is not listed, or whose folder is gone, itself.
      if (project && !project.missing) useProject(project)
      return indexHtml(res)
    }
    if (isView) {
      const last = lastProject()
      if (!last) return indexHtml(res)
      res.writeHead(302, { location: `/p/${encodeURIComponent(last.name)}${rest === '/' ? '/map' : rest}${url.search}` })
      return res.end()
    }
    const file = join(WEB, normalize(url.pathname))
    if (!file.startsWith(WEB) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end('not found')
      return
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
    res.end(readFileSync(file))
  }

  const server = createServer((req, res) => {
    route(req, res).catch((err) => {
      console.error(`werk: ${req.method} ${req.url} failed:`, (err as Error).message)
      send(res, 500, { ok: false, error: (err as Error).message })
    })
  })

  /**
   * A change under web/ needs a real page load, not a redraw. The browser is holding the
   * old app.js and the old style.css, and `changed` only refetches the graph.
   */
  let reloadTimer: NodeJS.Timeout | undefined
  watch(WEB, { recursive: true }, () => {
    clearTimeout(reloadTimer)
    reloadTimer = setTimeout(() => pushAll('reload', 1), 120)
  })

  // The lock waits out a `node --watch` restart, and the port has to wait with it. The
  // old process can still hold the socket for a moment after it lets go of the lock.
  let portTries = 0
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE' && portTries++ < 20) {
      setTimeout(() => server.listen(port), 250)
      return
    }
    if (err.code === 'EADDRINUSE') {
      console.error(`werk: port ${port} is taken. Another werk is running, or pass --port.`)
      process.exit(1)
    }
    throw err
  })

  server.listen(port, () => {
    listenDone()
    console.log(`werk map on http://localhost:${port}`)
    for (const p of listProjects()) console.log(`  ${p.name}${p.missing ? ' (missing)' : ''}  ${p.root}`)
    if (first) {
      const session = fresh ? null : inProject(first.root, () => readSession(paths.werk))
      console.log(session ? `resuming conversation ${session} in ${first.name}` : `starting a new conversation in ${first.name}`)
    }
  })

  const closeAll = () => {
    for (const o of live.values()) o.close()
  }
  process.on('exit', closeAll)
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      closeAll()
      process.exit(0)
    })
  }
}

/** Open one project: take its lock, start its conversations, its board and its watchers.
 *  Called inside the project's context, so everything it starts belongs to the project. */
async function openProject(project: Project, o: OpenOptions): Promise<Opened> {
  const { port, allow, fresh } = o
  await takeLock(port)
  const LOCK_PATH = lockPath()
  void o.listening.then(() => fillLockPort(LOCK_PATH, port))
  const clients = new Set<ServerResponse>()
  /** #vi-prop's kill metric: one fold per rederive, done once per open project. */
  const rederiveMemo = new Map<string, Rederive | null>()
  // #werk-cli-serve: two optional environment values shorten the idle sweep. A value that is
  // not a positive whole number is ignored, and the defaults of #werk-mc-reap-sweep hold.
  const manager = new ConvoManager(projectRoot(), allow, fresh, {
    reapMs: wholeMs(process.env.WERK_IDLE_MS),
    checkMs: wholeMs(process.env.WERK_IDLE_CHECK_MS),
  })
  let diagramSync: ReturnType<typeof startSysdiagSync> | null = null

  const push = (event: string, data: unknown) => {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    for (const client of clients) client.write(frame)
  }

  // Wired once per conversation, `main` included, so every tab's messages, deltas, status
  // and context land on the stream tagged with the conversation they belong to — see
  // #werk-multichat. The pane routes each event to that tab's own log.
  manager.onSpawn((agent) => {
    agent.onMessage((m) => push('chat', { ...m, convo: agent.name }))
    agent.onDelta((d) => push('delta', { ...d, convo: agent.name }))
    agent.onStatus((s) => {
      push('status', { ...s, convo: agent.name })
      o.onBusy()
    })
    agent.onContext((c) => push('context', { ...c, convo: agent.name }))
    // #werk-mc-bgagents: its own event, not folded into `status` — a background task
    // outlives the turn that started it, so it must not wait for the next status change.
    agent.onBackground((tasks) => push('background', { tasks, convo: agent.name }))
  })
  manager.main()

  // #vi-board: the ticket board's routes, its `board` and `ticket-log` pushes, and the
  // build children a trigger starts.
  const board = boardRoutes({
    push,
    // #werk-board-build-subtree: the Build button's scope check is the plan's own. A ghost is
    // not in the map yet, so it has nothing to build.
    blockers: (id) => {
      const g = foldLog('/api/subtree/build')
      const n = g.nodes.get(id)
      return n && n.kind === 'card' && !n.proposed ? planBlockers(g, id) : undefined
    },
    // #st-run-start-guard: a run in progress on an ancestor refuses every start on the card.
    ancestors: (id) => ancestorsOf(foldLog('/api/subtree/build'), id),
  })

  const { asks } = manager
  asks.onChange((open) => push('asks', open))
  // A pending question is a stalled turn. The indicator has to say so, or the pane looks
  // hung — for whichever tab is actually waiting, not only the one in focus. #werk-mc-asks.
  asks.onChange((open) => {
    const waiting = new Map(open.map((a) => [a.convo, a]))
    for (const agent of manager.list()) {
      const ask = waiting.get(agent.name)
      push('status', ask ? { state: 'asking', detail: ask.label, tokens: agent.status.tokens, convo: agent.name } : { ...agent.status, convo: agent.name })
    }
  })

  function handle(req: IncomingMessage, res: ServerResponse, url: URL): boolean | void {
    if (board.handle(req, res, url)) return

    // A pasted image is written next to the transcript, and the agent reads it by path.
    if (url.pathname === '/api/upload' && req.method === 'POST') {
      const type = String(req.headers['content-type'] ?? '')
      readBytes(req)
        .then((bytes) => {
          const ext = EXT[type]
          if (!ext) throw new Error(`werk takes png, jpeg, gif or webp, not "${type}"`)
          mkdirSync(paths.attachments, { recursive: true })
          // #werk-chat-image-inline-folder: one pattern that matches every file, itself included.
          const ignore = join(paths.attachments, '.gitignore')
          if (!existsSync(ignore)) writeFileSync(ignore, '*\n')
          const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}${ext}`
          const path = join(paths.attachments, name)
          writeFileSync(path, bytes)
          res.writeHead(200, { 'content-type': MIME['.json'] })
          res.end(JSON.stringify({ ok: true, path, name, bytes: bytes.length }))
        })
        .catch((err) => {
          res.writeHead(400, { 'content-type': MIME['.json'] }).end(JSON.stringify({ ok: false, error: err.message }))
        })
      return
    }

    // Thumbnails. basename strips any path, so only one flat directory is reachable.
    if (url.pathname === '/api/image') {
      const asked = url.searchParams.get('name') ?? ''
      // A plain file name only: a letter or digit first, then letters, digits, dots, dashes
      // and underscores, with no two dots in a row. Anything else finds no image.
      const name = /^[A-Za-z0-9][\w.-]*$/.test(asked) && !asked.includes('..') ? asked : ''
      const file = join(paths.attachments, name)
      if (!name || !existsSync(file) || !statSync(file).isFile()) {
        res.writeHead(404).end('not found')
        return
      }
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
      res.end(readFileSync(file))
      return
    }

    if (url.pathname === '/api/chat' && req.method === 'POST') {
      readBody(req)
        .then(({ text, card, images, convo, turn }) => {
          if (!text?.trim() && !(images ?? []).length) throw new Error('a message needs text or an image')
          // #werk-chat-card-missing: no card, or an empty one, names the home card. A card
          // that is not text is a broken request.
          if (card !== undefined && card !== null && typeof card !== 'string') throw new Error('the open card must be text')
          card = card || '~home'
          // #werk-chat-turn-name-limits: 1 to 100 of letters, digits, dots, dashes and
          // underscores, and no leading dot. The name goes into every event and into the page.
          if (turn != null && (typeof turn !== 'string' || !/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$/.test(turn)))
            throw new Error('a turn name holds 1 to 100 letters, digits, dots, dashes or underscores, and does not start with a dot')
          // A tab you type in is on the strip, so it is no longer a #werk-mc-reap target.
          manager.unpark(convo || MAIN)
          manager.ensure(convo || MAIN).send(text?.trim() ?? '', card, images ?? [], turn ?? undefined)
          res.writeHead(200, { 'content-type': MIME['.json'] }).end(JSON.stringify({ ok: true }))
        })
        .catch((err) => {
          res.writeHead(400, { 'content-type': MIME['.json'] }).end(JSON.stringify({ ok: false, error: err.message }))
        })
      return
    }

    // There is no /api/ask. The question arrives on the child's stdout and the answer goes
    // back on its stdin, both inside agent.ts. Only the click needs an HTTP route. One
    // shared queue for every conversation, so no convo param: the id alone finds it.
    if (url.pathname === '/api/ask/answer' && req.method === 'POST') {
      readBody(req)
        .then(({ id, decision, message }) => {
          if (!['allow', 'always', 'deny'].includes(decision)) throw new Error('decision must be allow, always or deny')
          const found = asks.answer(String(id), decision as Decision, typeof message === 'string' ? message : undefined)
          res.writeHead(200, { 'content-type': MIME['.json'] }).end(JSON.stringify({ ok: true, found }))
        })
        .catch((err) => {
          res.writeHead(400, { 'content-type': MIME['.json'] }).end(JSON.stringify({ ok: false, error: err.message }))
        })
      return
    }

    // A reloaded pane must find the open questions again, or the turn stays stuck. Every
    // conversation's, not just one — the bar has to rebuild itself for the whole strip.
    // `always` is keyed by conversation: each child launched with its own --allowedTools,
    // so an ask is read against the agent that asked it, not `main`'s. #werk-mc-asks.
    if (url.pathname === '/api/ask/open') {
      const open = asks.open()
      const always: Record<string, string[]> = {}
      for (const a of open) always[a.convo] ??= manager.ensure(a.convo).allowedTools()
      res.writeHead(200, { 'content-type': MIME['.json'], 'cache-control': 'no-store' })
      res.end(JSON.stringify({ open, always }))
      return
    }

    if (url.pathname === '/api/chat/history') {
      const name = url.searchParams.get('convo') || MAIN
      // A tab the browser saved for a conversation that has no session or transcript on disk.
      if (name !== MAIN && !manager.get(name) && !describeConvoDisk(name)) {
        res.writeHead(404, { 'content-type': MIME['.json'] }).end(JSON.stringify({ error: `no conversation named "${name}"` }))
        return
      }
      const agent = manager.ensure(name)
      res.writeHead(200, { 'content-type': MIME['.json'], 'cache-control': 'no-store' })
      res.end(
        JSON.stringify({
          messages: agent.history(),
          busy: agent.busy,
          status: agent.status,
          model: agent.modelSetting(),
          context: agent.context(),
          background: agent.background(),
        }),
      )
      return
    }

    // Every open conversation, live or only on disk from a past server run, for the tab
    // strip and its parked menu. See #werk-mc-tabs and #werk-mc-park.
    if (url.pathname === '/api/convos') {
      const live = manager.list()
      const liveNames = new Set(live.map((a) => a.name))
      const disk = listConvos().filter((c) => !liveNames.has(c.name))
      // #werk-mc-desc: the switcher row's description is the session's own title.
      const title = (name: string) => {
        const c = describeConvoDisk(name)
        return c ? convoTitle(c) : ''
      }
      res.writeHead(200, { 'content-type': MIME['.json'], 'cache-control': 'no-store' })
      res.end(
        JSON.stringify({
          convos: [
            ...live.map((a) => ({
              name: a.name,
              home: a.home,
              at: a.at(),
              status: a.status,
              dead: a.dead,
              live: true,
              background: a.background(),
              title: title(a.name),
            })),
            ...disk.map((c) => ({
              name: c.name,
              home: c.home,
              at: c.at,
              status: { state: 'idle' },
              dead: false,
              live: false,
              background: [],
              title: convoTitle(c),
            })),
          ],
        }),
      )
      return
    }

    // #werk-mc-fork: fork `from`'s current session into a new conversation at `atCard`,
    // focused there. Shift+click and the tab strip's "+" both land here.
    if (url.pathname === '/api/convo/fork' && req.method === 'POST') {
      readBody(req)
        .then(({ from, atCard }) => {
          if (!atCard) throw new Error('a fork needs the card it is rooted at')
          const agent = manager.fork(from || MAIN, atCard)
          res.writeHead(200, { 'content-type': MIME['.json'] }).end(JSON.stringify({ ok: true, name: agent.name }))
        })
        .catch((err) => {
          res.writeHead(400, { 'content-type': MIME['.json'] }).end(JSON.stringify({ ok: false, error: err.message }))
        })
      return
    }

    // #werk-mc-empty-control: "Start empty" in the "+" menu. A new conversation at `atCard`
    // with no parent session.
    if (url.pathname === '/api/convo/new' && req.method === 'POST') {
      readBody(req)
        .then(({ atCard }) => {
          if (!atCard) throw new Error('a new conversation needs the card it is rooted at')
          const agent = manager.startEmpty(String(atCard))
          res.writeHead(200, { 'content-type': MIME['.json'] }).end(JSON.stringify({ ok: true, name: agent.name }))
        })
        .catch((err) => {
          res.writeHead(400, { 'content-type': MIME['.json'] }).end(JSON.stringify({ ok: false, error: err.message }))
        })
      return
    }

    // #werk-mc-park / #werk-mc-close: the tab left the strip. Its child keeps running until
    // #werk-mc-reap's sweep finds it parked and untouched for long enough. /unpark puts it
    // back. /interrupt is the one route that kills a child on purpose, now.
    for (const [route, act] of [
      ['/api/convo/park', (n: string) => manager.park(n)],
      ['/api/convo/unpark', (n: string) => manager.unpark(n)],
      ['/api/convo/interrupt', (n: string) => manager.interrupt(n)],
    ] as const) {
      if (url.pathname !== route || req.method !== 'POST') continue
      readBody(req)
        .then(({ name }) => {
          if (!name) throw new Error(`${route} needs a conversation name`)
          act(String(name))
          res.writeHead(200, { 'content-type': MIME['.json'] }).end(JSON.stringify({ ok: true }))
        })
        .catch((err) => {
          res.writeHead(400, { 'content-type': MIME['.json'] }).end(JSON.stringify({ ok: false, error: err.message }))
        })
      return
    }

    // Drops the stored session and the visible transcript. Same busy guard as a model
    // switch: --model and a cleared context both take effect only when the child restarts.
    if (url.pathname === '/api/context/clear' && req.method !== 'POST') {
      res.writeHead(405, { 'content-type': MIME['.json'] }).end(JSON.stringify({ ok: false, error: 'clearing the context takes a POST' }))
      return
    }
    if (url.pathname === '/api/context/clear' && req.method === 'POST') {
      try {
        const agent = manager.ensure(url.searchParams.get('convo') || MAIN)
        // #werk-model-select-clear-address: a turn that runs is a conflict, and the answer says busy.
        if (agent.busy) {
          res.writeHead(409, { 'content-type': MIME['.json'] }).end(JSON.stringify({ ok: false, busy: true, error: 'the agent is busy: wait for the current turn to finish before clearing the context' }))
          return
        }
        agent.clearContext()
        // #werk-model-select-events: every open page drops its transcript.
        push('cleared', { convo: agent.name })
        push('context', { ...agent.context(), convo: agent.name })
        res.writeHead(200, { 'content-type': MIME['.json'] }).end(JSON.stringify({ ok: true }))
      } catch (err) {
        res.writeHead(400, { 'content-type': MIME['.json'] }).end(JSON.stringify({ ok: false, error: (err as Error).message }))
      }
      return
    }

    // A restart is the only way to change --model, so this can't apply mid-turn — the pane
    // disables the selector while busy, and setModel throws if that is bypassed.
    if (url.pathname === '/api/model' && req.method !== 'POST') {
      res.writeHead(405, { 'content-type': MIME['.json'] }).end(JSON.stringify({ ok: false, error: 'switching the model takes a POST' }))
      return
    }
    if (url.pathname === '/api/model' && req.method === 'POST') {
      readBody(req)
        .then(({ model, advisor, convo }) => {
          if (!['claude-sonnet-5-5[1m]', 'claude-opus-5-5'].includes(model)) throw new Error('model must be claude-sonnet-5-5[1m] or claude-opus-5-5')
          if (advisor != null && advisor !== 'claude-opus-5-5') throw new Error('advisor must be claude-opus-5-5 or none')
          const agent = manager.ensure(convo || MAIN)
          if (agent.busy) {
            res.writeHead(409, { 'content-type': MIME['.json'] }).end(JSON.stringify({ ok: false, busy: true, error: 'the agent is busy: wait for the current turn to finish before switching models' }))
            return
          }
          agent.setModel(model, advisor ?? null)
          push('model', { ...agent.modelSetting(), ...agent.context(), convo: agent.name })
          res.writeHead(200, { 'content-type': MIME['.json'] }).end(JSON.stringify({ ok: true }))
        })
        .catch((err) => {
          res.writeHead(400, { 'content-type': MIME['.json'] }).end(JSON.stringify({ ok: false, error: err.message }))
        })
      return
    }

    // #al-diff-cli's fast path: a click instead of typing "accept" to the agent. Discard
    // has no button on purpose — that path goes through the agent, by naming what's wrong.
    // The same ✓ makes a ghost card real (#werk-propose-new), taking its ghost parents and
    // its own options with it — acceptClosure, the same function the CLI runs.
    if (url.pathname === '/api/change/accept' && req.method === 'POST') {
      readBody(req)
        .then(({ id }) => {
          const g = foldLog(url.pathname)
          const node = g.nodes.get(id)
          if (!node) throw new Error(`no node with the id "${id}"`)
          if (!node.pending && !node.proposed) throw new Error(`"${id}" has no pending proposal.`)
          // A proposed removal: the ✓ runs it — #werk-remove.
          if (node.pending?.remove) {
            const { moves, ids } = planRemoval(g, id, node.pending.reparent)
            append('change.accepted', { id }, { actor: 'you' })
            for (const m of moves) append('level.moved', m, { actor: 'you' })
            for (const each of ids) append('node.removed', { id: each }, { actor: 'you' })
            res.writeHead(200, { 'content-type': MIME['.json'] }).end(JSON.stringify({ ok: true, removed: ids }))
            return
          }
          // The ✓ on a change to a decided card is an amend: every fact must hold after it —
          // #werk-contract-amend-scope.
          const refusal = node.proposed ? undefined : amendRefusal(g, id, pendingChange(node.pending), true)
          if (refusal) throw new Error(refusal)
          const ids = node.proposed ? acceptClosure(g, id) : [id]
          appendMany(ids.map((each) => ({ type: 'change.accepted' as const, payload: { id: each }, actor: 'you' as const })))
          res.writeHead(200, { 'content-type': MIME['.json'] }).end(JSON.stringify({ ok: true, accepted: ids }))
        })
        .catch((err) => {
          res.writeHead(400, { 'content-type': MIME['.json'] }).end(JSON.stringify({ ok: false, error: err.message }))
        })
      return
    }

    // #werk-remove: cleanup happens while reading the map, so the ✕ is on the card. A ghost
    // has no ✕ — it is discarded instead, which is the same click for a card that was never
    // real. Removal is reversible, so this needs no confirmation step of its own.
    if (url.pathname === '/api/node/remove' && req.method === 'POST') {
      readBody(req)
        .then(({ id, reparent }) => {
          const g = foldLog(url.pathname)
          const node = g.nodes.get(id)
          if (!node) throw new Error(`no node with the id "${id}"`)
          if (id === WHAT) throw new Error(`the top card #${WHAT} cannot be removed`)
          if (node.proposed) {
            appendMany([...discardClosure(g, id)].reverse().map((each) => ({ type: 'change.discarded' as const, payload: { id: each }, actor: 'you' as const })))
            res.writeHead(200, { 'content-type': MIME['.json'] }).end(JSON.stringify({ ok: true, discarded: true }))
            return
          }
          const { moves, ids } = planRemoval(g, id, reparent === true)
          for (const m of moves) append('level.moved', m, { actor: 'you' })
          for (const each of ids) append('node.removed', { id: each }, { actor: 'you' })
          res.writeHead(200, { 'content-type': MIME['.json'] }).end(JSON.stringify({ ok: true, removed: ids }))
        })
        .catch((err) => {
          res.writeHead(400, { 'content-type': MIME['.json'] }).end(JSON.stringify({ ok: false, error: err.message }))
        })
      return
    }

    if (url.pathname === '/api/node/restore' && req.method === 'POST') {
      readBody(req)
        .then(({ id }) => {
          const g = foldLog(url.pathname)
          if (!g.removed.some((r) => r.id === id)) throw new Error(`"${id}" is not removed`)
          const outParent = g.removed.find((r) => r.id === id)?.parent
          if (outParent && g.removed.some((r) => r.id === outParent)) {
            throw new Error(`"${id}" sits under "${outParent}", which is still removed. Restore "${outParent}" first.`)
          }
          append('node.restored', { id }, { actor: 'you' })
          res.writeHead(200, { 'content-type': MIME['.json'] }).end(JSON.stringify({ ok: true }))
        })
        .catch((err) => {
          res.writeHead(400, { 'content-type': MIME['.json'] }).end(JSON.stringify({ ok: false, error: err.message }))
        })
      return
    }

    // Read once per request: skills and commands change rarely, and the composer only
    // fetches this on load, not on every keystroke of the `/` menu.
    if (url.pathname === '/api/commands') {
      res.writeHead(200, { 'content-type': MIME['.json'], 'cache-control': 'no-store' })
      res.end(JSON.stringify(listSlashCommands(projectRoot())))
      return
    }

    // #vi-sysdiag-render decided grid over the hand-drawn SVG, the intent+resolver router,
    // D2+TALA, and libavoid — see #vi-sysdiag-grid-mincell. ?style=X serves .werk/diagram-X.svg.
    // A convention, not a table, so adding a new grid variant costs a file and a button — no
    // edit here, and therefore no server restart (#werk-hmr's guard means a route edit inside
    // serve() only takes effect on a restart).
    if (url.pathname === '/api/diagram-sync') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify(diagramSync?.state() ?? null))
      return
    }

    if (url.pathname === '/api/diagram-svg') {
      const style = url.searchParams.get('style')
      // Strip anything that is not a plain style name — this value becomes a filename.
      const safe = (style ?? '').replace(/[^a-zA-Z0-9-]/g, '')
      const file = !safe ? 'diagram-grid-full-minimal.svg' : `diagram-${safe}.svg`
      const path = join(paths.werk, file)
      const body = existsSync(path) ? readFileSync(path, 'utf8') : ''
      res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'no-store' })
      res.end(body)
      return
    }

    // The text an agent actually authors, for whichever style has one — today only the grid
    // does (.werk/diagram-grid.wgrid). Same convention as diagram-svg above: ?style=X reads
    // .werk/diagram-X.wgrid, empty body if there is no such file, never an error.
    if (url.pathname === '/api/diagram-source') {
      const safe = (url.searchParams.get('style') ?? '').replace(/[^a-zA-Z0-9-]/g, '')
      const path = join(paths.werk, `diagram-${safe}.wgrid`)
      const body = safe && existsSync(path) ? readFileSync(path, 'utf8') : ''
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      res.end(body)
      return
    }

    if (url.pathname === '/api/graph') {
      const body = JSON.stringify(toJSON(foldLog(url.pathname)))
      res.writeHead(200, { 'content-type': MIME['.json'], 'cache-control': 'no-store' })
      res.end(body)
      return
    }

    // #vi-flowtab: the status history of each card. The Flow tab aggregates it.
    if (url.pathname === '/api/flow') {
      const body = JSON.stringify(cardFlows(readEvents()))
      res.writeHead(200, { 'content-type': MIME['.json'], 'cache-control': 'no-store' })
      res.end(body)
      return
    }

    // #vi-measure: the measures that belong to passes, runs and conversations, not to cards.
    // The tab windows them itself. Fold times are many, so `?days=all` is needed for more
    // than the last 30 days of them.
    if (url.pathname === '/api/measure') {
      const events = readEvents()
      const since = url.searchParams.get('days') === 'all' ? 0 : Date.now() - 30 * 864e5
      const folds = foldTimes(readText(paths.foldTimes), since)
      const body = JSON.stringify({ rederives: rederives(events, rederiveMemo), probes: readProbeCounts(join(paths.werk, 'runs')), waits: readChatWaits(asks.open()), folds, tests: readTestRuns().slice(-2000), measures: readMeasures() })
      res.writeHead(200, { 'content-type': MIME['.json'], 'cache-control': 'no-store' })
      res.end(body)
      return
    }

    if (url.pathname === '/api/live') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      })
      res.write(': connected\n\n')
      clients.add(res)
      req.on('close', () => clients.delete(res))
      return
    }

    return false
  }

  // The log is the truth. When it changes, every open map redraws.
  let timer: NodeJS.Timeout | undefined
  const notify = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      push('changed', 1)
    }, 60)
  }
  mkdirSync(paths.werk, { recursive: true })

  // #vi-sysdiag-quiet: the diagram follows the decided cards from here, never from a chat
  // turn. Off for a project that has no diagram file.
  diagramSync = existsSync(join(paths.werk, 'diagram-grid-full-minimal.wgrid')) && !process.env.WERK_NO_DIAGRAM_SYNC
    ? startSysdiagSync({
        werkDir: paths.werk,
        logPath: paths.log,
        runAgent: runClaudeAgent(projectRoot()),
        runBuild: runGridBuild(projectRoot(), paths.werk),
        onState: (s) => push('diagram', s),
        // #vi-sysdiag-declare: a restructure reaches the map as a note on each card that caused it.
        onRestructure: (cards, reason) => {
          for (const node of cards) append('note.added', { node, text: `The diagram was restructured for this card: ${reason || 'no reason given'}` }, { actor: 'agent' })
        },
      })
    : null

  // The chat transcript shares the .werk directory. Only the log redraws the map. A pipeline
  // event touches no card, so it sends its own signal and only the Measure panels read again.
  let measureTimer: NodeJS.Timeout | undefined
  const pipelineName = basename(paths.pipeline)
  const logWatch = watch(paths.werk, (_, name) => {
    if (name === pipelineName) {
      clearTimeout(measureTimer)
      measureTimer = setTimeout(() => push('measure', 1), 60)
      return
    }
    if (name !== 'log.jsonl') return
    notify()
    diagramSync?.poke()
  })
  mkdirSync(paths.attachments, { recursive: true })
  const stopBoard = board.start()

  return {
    project,
    handle,
    push,
    running: () => manager.list().filter((a) => a.busy).map((a) => a.name),
    close: () => {
      manager.stopAll()
      stopBoard()
      diagramSync?.stop()
      logWatch.close()
      clearTimeout(timer)
      clearTimeout(measureTimer)
      for (const client of clients) client.end()
      clients.clear()
      releaseLock(LOCK_PATH)
    },
  }
}
