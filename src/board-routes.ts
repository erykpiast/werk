/**
 * The board's HTTP routes, its live channel, and the build children it starts. See #vi-board,
 * #werk-board-control.
 *
 * Kept out of server.ts so a test can mount it on a bare http server with a scratch board and
 * a stub build command, with no agent and no lock. server.ts calls handle() before its own
 * routes and passes its SSE push in.
 *
 * Every write here is a person's action (actor "you"), checked by board.ts's rules first:
 * manualMove for trigger and stop, canArchive for archive, checkReorder for reorder.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, watch, type FSWatcher } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  appendBoard,
  buildHolder,
  buildRefusal,
  canArchive,
  checkReorder,
  columns,
  COLUMNS,
  endUnfinishedWork,
  foldBoard,
  manualMove,
  readBoard,
  restartLines,
  restartPlan,
  restartRefusal,
  resumeRefusal,
  runHolder,
  startRefusal,
  unfinishedWork,
  type Board,
  type Plan,
  type Ticket,
} from './board.ts'
import { isTicketId, logLineTime, summarizeLogLine } from './board-text.ts'
import { readTicketText } from './board-files.ts'
import { paths, projectRoot } from './project.ts'

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'cli.ts')

export type BoardRoutesOptions = {
  boardPath?: string
  ticketsDir?: string
  cwd?: string
  /** The argv a trigger spawns when no `werk run` holds the ticket's run. Default:
   *  bun src/cli.ts run <run>, which builds the triggered ticket first (#werk-board-control). */
  buildCommand?: (id: string) => string[]
  /** The open and proto cards in the plan scope of a map card, or undefined when the map has
   *  no such card. Without it, the Build button refuses every card. */
  blockers?: (id: string) => string[] | undefined
  /** The argv the map's Build button spawns: the plan, then the merge loop on a plan that
   *  ended ok (#werk-board-build-subtree). */
  subtreeCommand?: (id: string) => string[]
  /** The argv Resume spawns: the merge loop again over the subtree's tickets
   *  (#werk-board-restart). */
  resumeCommand?: (id: string) => string[]
  /** The refines ancestors of a map card, nearest first. A run in progress on one of them
   *  refuses every start on the card (#st-run-start-guard). Default: none. */
  ancestors?: (id: string) => string[]
  push?: (event: string, data: unknown) => void
  /** How often to look for new lines in a building ticket's log. */
  tailMs?: number
}

const JSON_TYPE = 'application/json; charset=utf-8'

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': JSON_TYPE, 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function readJson(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

/**
 * Read whole lines appended to a file since `offset`. A half-written last line waits. Each
 * line carries `end`, the byte offset just past its newline, so a reader that already holds
 * the file up to some offset can drop what it has. `reset` is true when the file shrank
 * below `offset` (truncated or replaced) and the read started again from 0.
 */
export function readFrom(path: string, offset: number): { lines: Array<{ raw: string; end: number }>; offset: number; reset: boolean } {
  const size = statSync(path).size
  const reset = size < offset
  if (reset) offset = 0
  if (size === offset) return { lines: [], offset, reset }
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.alloc(size - offset)
    readSync(fd, buf, 0, buf.length, offset)
    const last = buf.lastIndexOf(0x0a)
    if (last < 0) return { lines: [], offset, reset }
    const lines: Array<{ raw: string; end: number }> = []
    let start = 0
    while (start <= last) {
      const nl = buf.indexOf(0x0a, start)
      lines.push({ raw: buf.toString('utf8', start, nl), end: offset + nl + 1 })
      start = nl + 1
    }
    return { lines, offset: offset + last + 1, reset }
  } finally {
    closeSync(fd)
  }
}

export type LogLine = { text: string; end: number; at?: string }

/** The lines of a read a person reads in the preview, each with its end offset and, when the
 *  raw line has one, its time. */
function summarize(lines: Array<{ raw: string; end: number }>): LogLine[] {
  const out: LogLine[] = []
  for (const l of lines) {
    const text = summarizeLogLine(l.raw)
    if (!text) continue
    const at = logLineTime(l.raw)
    out.push(at ? { text, end: l.end, at } : { text, end: l.end })
  }
  return out
}

/** The last few lines a child wrote to a file, on one line, clipped. Empty when it wrote none. */
export function outputTail(path: string, lines = 3, max = 400): string {
  if (!existsSync(path)) return ''
  const text = readFileSync(path, 'utf8')
  const tail = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-lines)
    .join(' / ')
  return tail.length > max ? `…${tail.slice(-(max - 1))}` : tail
}

/** True when a process with this pid exists and this user may signal it. */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** The argv a trigger spawns: the merge loop over the ticket's run. It builds in the project's
 *  target (#st-build-target), and refuses when none is set. */
export function runCommand(b: Board, id: string): string[] {
  const run = b.tickets.get(id)?.run ?? id.split('/')[0]
  return ['bun', CLI, 'run', run]
}

/** The argv the Build button spawns: plan the subtree, and run it only when the plan ended ok. */
export function subtreeCommand(id: string): string[] {
  return ['sh', '-c', 'bun "$0" plan "$1" && bun "$0" run "$1"', CLI, id]
}

/** The argv Resume spawns: the merge loop over the subtree's tickets, which builds the tickets
 *  a stopped loop left first (#st-build-run-mechanics). */
export function resumeCommand(id: string): string[] {
  return ['bun', CLI, 'run', id]
}

export function boardRoutes(opts: BoardRoutesOptions = {}) {
  const boardPath = opts.boardPath ?? paths.board
  const ticketsDir = opts.ticketsDir ?? paths.tickets
  const cwd = opts.cwd ?? projectRoot()
  const buildCommand = opts.buildCommand ?? ((id: string) => runCommand(board(), id))
  const blockers = opts.blockers ?? (() => undefined)
  const spawnSubtree = opts.subtreeCommand ?? subtreeCommand
  const spawnResume = opts.resumeCommand ?? resumeCommand
  const ancestors = opts.ancestors ?? (() => [])
  const push = opts.push ?? (() => {})
  const children = new Map<string, ChildProcess>()

  const board = (): Board => foldBoard(readBoard(boardPath))
  const logPath = (t: Ticket) => (t.log ? (isAbsolute(t.log) ? t.log : join(cwd, t.log)) : undefined)

  function view() {
    const b = board()
    const cols = columns(b)
    const tickets = [...b.tickets.values()].map((t) => {
      const text = readTicketText(t, ticketsDir, cwd)
      // #vi-board-session-file: a session runs while the board log says it started and has not
      // ended, and its process is alive. A build under `werk run` names no process of its own:
      // the run's process is its process. A start that names no process at all is trusted.
      const pid = t.pid ?? b.runs.get(t.run)?.pid
      const live = t.live && (children.has(t.id) || pid === undefined || alive(pid))
      return {
        ...t,
        live,
        // A trigger the person can press right now. The board greys the icon otherwise.
        canTrigger: manualMove(t, 'building').ok,
        canArchive: canArchive(t),
        // A build is still running, spawned by this server or found by its recorded pid: the
        // stop drag has something to kill.
        running: children.has(t.id) || (live && !!t.pid),
        text: text ?? null,
      }
    })
    return {
      seq: b.seq,
      // Per plan run: its tier and its gates (gate.waiting / gate.passed), for the run strip.
      runs: Object.fromEntries(b.runs),
      columns: Object.fromEntries(COLUMNS.map((c) => [c, cols[c].map((t) => t.id)])),
      tickets,
      // #vi-board-plan: one card per planned subtree, in the row below the columns.
      plans: [...b.plans.values()].map(planView).sort((x, y) => (y.startedAt ?? '').localeCompare(x.startedAt ?? '') || x.run.localeCompare(y.run)),
    }
  }

  /** A plan whose process died without plan.ended would pulse forever: it shows as stopped. */
  function planView(p: Plan): Plan & { building: boolean; inProgress: boolean; unfinished: number; blockedBy: string | null } {
    // #werk-board-build-subtree: a Build-button build that is alive shows its stop.
    const building = p.buildPid !== undefined && alive(p.buildPid)
    // #vi-board-plan-controls: the plan card offers Resume and Restart while the subtree has
    // unfinished work and no run is in progress on it; a run above it disables them.
    const b = board()
    const busy = startRefusal(b, p.run, ancestors(p.run), alive)
    const controls = { inProgress: busy?.run === p.run, unfinished: unfinishedWork(b, p.run).length, blockedBy: busy?.run ?? null }
    if (!p.live || p.pid === undefined || alive(p.pid)) return { ...p, building, ...controls }
    return { ...p, building, ...controls, live: false, state: 'stopped', result: 'error', detail: 'the plan process ended without a result' }
  }

  function lookupPlan(run: unknown): Plan {
    const p = typeof run === 'string' ? board().plans.get(run) : undefined
    if (!p) throw Object.assign(new Error(`no plan of the subtree ${JSON.stringify(run ?? null)} on the board`), { status: 404 })
    return planView(p)
  }

  const planLogPath = (path: string) => (isAbsolute(path) ? path : join(cwd, path))

  /** Both writers' logs, spec writer first, each line tagged with its step. */
  function planLog(p: Plan): Array<Omit<LogLine, 'end'> & { step: string }> {
    const out: Array<Omit<LogLine, 'end'> & { step: string }> = []
    for (const l of p.logs) {
      const path = planLogPath(l.path)
      if (!existsSync(path)) continue
      for (const { end, ...line } of summarize(readFrom(path, 0).lines)) out.push({ ...line, step: l.step })
    }
    return out.slice(-500)
  }

  /** The spec the plan wrote, whole; empty until the spec writer has written it. */
  function planSpec(p: Plan): string {
    const path = join(cwd, '.werk', 'specs', `${p.run}.md`)
    return existsSync(path) ? readFileSync(path, 'utf8') : ''
  }

  function lookup(id: unknown): Ticket {
    if (typeof id !== 'string' || !isTicketId(id)) {
      throw Object.assign(new Error(`not a ticket id: ${JSON.stringify(id ?? null)} (expected "<run>/<number>")`), { status: 400 })
    }
    const t = board().tickets.get(id)
    if (!t) throw Object.assign(new Error(`no ticket with the id "${id}"`), { status: 404 })
    return t
  }

  function refuse(why: string): never {
    throw Object.assign(new Error(why), { status: 409 })
  }

  /**
   * A build the trigger started that never reached ticket.build.started — `werk build`
   * refused the ticket, or the process did not start — would sit in building, not live, until
   * a person dragged it back. Move it back to ready with the reason instead.
   */
  function sendBackIfRefused(id: string, triggerSeq: number, why: string) {
    const events = readBoard(boardPath)
    const started = events.some((e) => e.seq > triggerSeq && e.type === 'ticket.build.started' && (e.payload as { id: string }).id === id)
    if (started || foldBoard(events).tickets.get(id)?.column !== 'building') return
    appendBoard('ticket.moved', { id, to: 'ready', reason: why }, { path: boardPath })
  }

  function startBuild(id: string, triggerSeq: number): ChildProcess {
    const [cmd, ...args] = buildCommand(id)
    // The child's output goes to files, not pipes: a pipe would break when this server
    // restarts, and the build must outlive that. Their tail is the reason for a refusal.
    const outDir = join(dirname(boardPath), 'board-spawn')
    mkdirSync(outDir, { recursive: true })
    const base = join(outDir, id.replace(/[^A-Za-z0-9_.-]+/g, '-'))
    const out = openSync(`${base}.out`, 'w')
    const err = openSync(`${base}.err`, 'w')
    // Detached: the build outlives a server restart (its own events land in board.jsonl),
    // and a stop can signal its whole process group, the builder's children included.
    let child: ChildProcess
    try {
      child = spawn(cmd, args, {
        cwd,
        detached: true,
        stdio: ['ignore', out, err],
        env: { ...process.env, WERK_BOARD: boardPath, WERK_BUILD_GROUP: '1' },
      })
    } finally {
      closeSync(out)
      closeSync(err)
    }
    children.set(id, child)
    let settled = false
    child.on('error', (e) => {
      children.delete(id)
      if (settled) return
      settled = true
      const t = board().tickets.get(id)
      const detail = `the build did not start: ${e.message}`
      appendBoard('ticket.build.ended', { id, loopRun: t?.loopRun ?? '', result: 'error', detail }, { path: boardPath })
      sendBackIfRefused(id, triggerSeq, detail)
    })
    child.on('exit', (code, signal) => {
      children.delete(id)
      if (settled) return
      settled = true
      // The build verb ends its own session. One that died first would pulse forever.
      reap()
      const said = outputTail(`${base}.err`) || outputTail(`${base}.out`)
      const how = signal ? `was killed by ${signal}` : `exited with ${code}`
      sendBackIfRefused(id, triggerSeq, said ? `the build refused: ${said}` : `the build ${how} before it started`)
    })
    child.unref()
    return child
  }

  /**
   * #st-build-died: a session that started, has no end, and whose process is gone died. Its
   * end is written as `died`, and its run starts again unless a live `werk run` holds it. The
   * merge loop builds a ticket in building first, from the passes the dead build committed.
   * Runs when a child of this server exits and when the server starts.
   */
  function reap() {
    const b = board()
    const restart = new Map<string, { id: string; seq: number }>()
    for (const t of b.tickets.values()) {
      if (!t.live || children.has(t.id)) continue
      // A build under `werk run` names no process of its own: the run's process is its process.
      const pid = t.pid ?? b.runs.get(t.run)?.pid
      if (pid === undefined || alive(pid)) continue
      const ended = appendBoard('ticket.build.ended', { id: t.id, loopRun: t.loopRun ?? '', result: 'died', detail: `the build process ${pid} is gone` }, { path: boardPath })
      if (t.column === 'building' && !t.archived && !restart.has(t.run)) restart.set(t.run, { id: t.id, seq: ended.seq })
    }
    for (const [run, { id, seq }] of restart) {
      if (runHolder(board(), run, alive) === undefined) startBuild(id, seq)
    }
  }

  /**
   * Stop a ticket's build. A child this server spawned comes first. Otherwise the pid that
   * `werk build` wrote in ticket.build.started: a build started before a server restart, or
   * from a terminal. The pid is signalled only while the session is live and the process is
   * alive; its process group only when the build said it leads one.
   */
  function stopBuild(t: Ticket): boolean {
    const child = children.get(t.id)
    if (child?.pid) {
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch {
        try {
          child.kill('SIGTERM')
        } catch {
          return false
        }
      }
      return true
    }
    if (!t.live || !t.pid || !alive(t.pid)) return false
    try {
      process.kill(t.pidGroup ? -t.pid : t.pid, 'SIGTERM')
      return true
    } catch {
      return false
    }
  }

  /**
   * #werk-board-build-subtree: plan the subtree, then run the merge loop, as one detached
   * process that leads its own group. Like a trigger's build, it outlives a server restart
   * and has no time limit; its output goes to files, and its pid to the board.
   */
  function startSubtree(id: string, argv: string[] = spawnSubtree(id)): ChildProcess {
    const [cmd, ...args] = argv
    const outDir = join(dirname(boardPath), 'board-spawn')
    mkdirSync(outDir, { recursive: true })
    const base = join(outDir, `build-${id.replace(/[^A-Za-z0-9_.-]+/g, '-')}`)
    const out = openSync(`${base}.out`, 'w')
    const err = openSync(`${base}.err`, 'w')
    let child: ChildProcess
    try {
      child = spawn(cmd, args, { cwd, detached: true, stdio: ['ignore', out, err], env: { ...process.env, WERK_BOARD: boardPath } })
    } finally {
      closeSync(out)
      closeSync(err)
    }
    if (child.pid !== undefined) appendBoard('build.started', { run: id, pid: child.pid }, { actor: 'you', path: boardPath })
    const ended = (detail: string) => {
      // A person's stop already ended it; a later build of the subtree is not this one's.
      if (board().plans.get(id)?.buildPid === child.pid) appendBoard('build.ended', { run: id, detail }, { path: boardPath })
    }
    child.on('error', (e) => ended(`the build did not start: ${e.message}`))
    child.on('exit', (code, signal) => {
      const said = outputTail(`${base}.err`)
      ended(signal ? `killed by ${signal}` : code === 0 ? 'the plan and the run ended' : `exited with ${code}${said ? `: ${said}` : ''}`)
    })
    child.unref()
    return child
  }

  async function post(url: URL, req: IncomingMessage): Promise<unknown> {
    const body = await readJson(req)
    switch (url.pathname) {
      case '/api/ticket/reorder': {
        const ids = Array.isArray(body.ids) ? body.ids.map(String) : refuse('reorder needs ids: the full new order of ready')
        const ok = checkReorder(board(), ids)
        if (!ok.ok) refuse(ok.why)
        appendBoard('ticket.reordered', { ids }, { actor: 'you', path: boardPath })
        return { ok: true }
      }
      case '/api/ticket/archive': {
        const t = lookup(body.id)
        if (!canArchive(t)) refuse(`${t.id} is in ${t.column}${t.archived ? ' and archived' : ''}; only a ready, blocked or building ticket is archived`)
        // #werk-board-control-archive-ends-build: the archive is the whole stop. It sends no
        // signal. The builder loop of the ticket reads the board and ends its own build.
        appendBoard('ticket.archived', { id: t.id }, { actor: 'you', path: boardPath })
        return { ok: true }
      }
      case '/api/ticket/trigger': {
        const t = lookup(body.id)
        const ok = manualMove(t, 'building')
        if (!ok.ok) refuse(ok.why)
        // A live `werk run` holds this run: it builds tickets in building first, so the move
        // is the whole trigger. Otherwise the trigger starts the run (#werk-board-control),
        // and a run in progress on the subtree or above it refuses that (#st-run-start-guard).
        const holder = runHolder(board(), t.run, alive)
        if (holder === undefined) {
          const busy = startRefusal(board(), t.run, ancestors(t.run), alive)
          if (busy) refuse(busy.why)
        }
        const moved = appendBoard('ticket.moved', { id: t.id, to: 'building' }, { actor: 'you', path: boardPath })
        if (holder !== undefined) return { ok: true, run: holder }
        const child = startBuild(t.id, moved.seq)
        return { ok: true, pid: child.pid }
      }
      case '/api/subtree/build': {
        const id = typeof body.id === 'string' ? body.id : refuse('build needs the id of a map card')
        const why = buildRefusal(board(), id, blockers(id), alive, ancestors(id))
        if (why) refuse(why)
        const child = startSubtree(id)
        return { ok: true, pid: child.pid }
      }
      // #werk-board-restart: Resume starts the merge loop again over the same tickets.
      case '/api/subtree/resume': {
        const id = typeof body.id === 'string' ? body.id : refuse('resume needs the id of a map card')
        const why = resumeRefusal(board(), id, alive, ancestors(id))
        if (why) refuse(why)
        const child = startSubtree(id, spawnResume(id))
        return { ok: true, pid: child.pid }
      }
      // A restart ends the unfinished work first: it cancels each running build and keeps its
      // branch, archives every unfinished ticket, then plans and runs again. It needs
      // `confirm: true`, so a press without the confirmation changes nothing.
      case '/api/subtree/restart': {
        const id = typeof body.id === 'string' ? body.id : refuse('restart needs the id of a map card')
        const why = restartRefusal(board(), id, blockers(id), alive, ancestors(id))
        if (why) refuse(why)
        if (body.confirm !== true) refuse(`${restartLines(id, restartPlan(board(), id)).join('\n')}\nthe restart needs a confirmation`)
        const ended = endUnfinishedWork(board(), id, { path: boardPath, actor: 'you', stop: stopBuild })
        const child = startSubtree(id)
        return { ok: true, pid: child.pid, ...ended }
      }
      case '/api/subtree/stop': {
        const run = typeof body.run === 'string' ? body.run : refuse('stop needs the subtree id')
        const pid = buildHolder(board(), run, alive)
        if (pid === undefined) refuse(`no build of ${run} is running`)
        // The group holds the plan, the merge loop, and their agents. The merge loop moves
        // what it left in building back to ready on SIGTERM (#st-build-stop-ready).
        try {
          process.kill(-pid!, 'SIGTERM')
        } catch {
          process.kill(pid!, 'SIGTERM')
        }
        appendBoard('build.ended', { run, detail: 'stopped by the person' }, { actor: 'you', path: boardPath })
        return { ok: true }
      }
    }
    return undefined
  }

  /**
   * What the map card's controls show (#vi-board-plan-controls): Build when the subtree has no
   * unfinished work, Resume and Restart when it has. `blockedBy` names the run in progress on
   * the subtree or an ancestor, which disables every start; the card links to its plan card.
   */
  function subtreeView(id: string) {
    const b = board()
    const found = blockers(id)
    const up = ancestors(id)
    const busy = startRefusal(b, id, up, alive)
    const unfinished = unfinishedWork(b, id)
    const action = unfinished.length ? 'resume' : 'build'
    const refusal = action === 'build' ? buildRefusal(b, id, found, alive, up) : resumeRefusal(b, id, alive, up)
    return {
      id,
      blockers: found ?? [],
      running: buildHolder(b, id, alive) !== undefined,
      action,
      refusal: refusal ?? null,
      restartRefusal: action === 'resume' ? (restartRefusal(b, id, found, alive, up) ?? null) : null,
      blockedBy: busy?.run ?? null,
      unfinished: unfinished.map((t) => ({ id: t.id, column: t.column, live: t.live && !!t.pid && alive(t.pid) })),
      restart: action === 'resume' ? restartLines(id, restartPlan(b, id)) : [],
    }
  }

  /** True when the route was the board's. */
  function handle(req: IncomingMessage, res: ServerResponse, url = new URL(req.url ?? '/', 'http://localhost')): boolean {
    if (url.pathname === '/api/board' && req.method === 'GET') {
      send(res, 200, view())
      return true
    }
    if (url.pathname === '/api/ticket/log' && req.method === 'GET') {
      try {
        const t = lookup(url.searchParams.get('id'))
        const path = logPath(t)
        // `offset` is the byte the read stopped at, after the last whole line. The live push
        // sends each line's end offset, so the preview drops what this read already gave it.
        const read = path && existsSync(path) ? readFrom(path, 0) : { lines: [], offset: 0 }
        const lines = summarize(read.lines).map(({ end, ...l }) => l)
        send(res, 200, { id: t.id, live: t.live, column: t.column, lines: lines.slice(-500), offset: read.offset })
      } catch (err) {
        send(res, (err as { status?: number }).status ?? 400, { ok: false, error: (err as Error).message })
      }
      return true
    }
    if (url.pathname === '/api/plan/log' && req.method === 'GET') {
      try {
        const p = lookupPlan(url.searchParams.get('run'))
        send(res, 200, { run: p.run, live: p.live, lines: planLog(p), spec: planSpec(p) })
      } catch (err) {
        send(res, (err as { status?: number }).status ?? 400, { ok: false, error: (err as Error).message })
      }
      return true
    }
    if (url.pathname === '/api/subtree/build' && req.method === 'GET') {
      send(res, 200, subtreeView(url.searchParams.get('id') ?? ''))
      return true
    }
    if ((url.pathname.startsWith('/api/ticket/') || url.pathname.startsWith('/api/subtree/')) && req.method === 'POST') {
      post(url, req)
        .then((out) => (out === undefined ? send(res, 404, { ok: false, error: 'not found' }) : send(res, 200, out)))
        .catch((err) => send(res, (err as { status?: number }).status ?? 400, { ok: false, error: (err as Error).message }))
      return true
    }
    return false
  }

  // ---- the live channel ----

  const watchers: FSWatcher[] = []
  let boardTimer: ReturnType<typeof setTimeout> | undefined
  let boardStamp: string | undefined
  const stampOf = () => {
    try {
      const st = statSync(boardPath)
      return `${st.size}:${st.mtimeMs}`
    } catch {
      return ''
    }
  }
  const changed = () => {
    clearTimeout(boardTimer)
    boardTimer = setTimeout(() => {
      // The poll below must not push a second time for a change a watcher already pushed.
      boardStamp = stampOf()
      push('board', 1)
    }, 60)
  }
  const offsets = new Map<string, { path: string; offset: number }>()

  /**
   * New lines in every live ticket's log, pushed as `ticket-log`: `{ id, from, reset, lines }`,
   * each line `{ text, end }`. `from` is the byte the batch starts at; a preview that holds
   * less than that has a gap and fetches /api/ticket/log again. `reset` says the file was
   * truncated and the batch starts over at 0.
   */
  function tail() {
    let b: Board
    try {
      b = board()
    } catch {
      return
    }
    for (const t of b.tickets.values()) {
      const path = logPath(t)
      if (!t.live || !path || !existsSync(path)) {
        offsets.delete(t.id)
        continue
      }
      let at = offsets.get(t.id)
      // A preview that opens mid-session backfills from /api/ticket/log; the push starts at
      // the end of the last whole line there when the tail first sees the file. The offsets
      // close the seam between the two: see the push's doc above.
      if (!at || at.path !== path) {
        at = { path, offset: readFrom(path, 0).offset }
        offsets.set(t.id, at)
        continue
      }
      const from = at.offset
      const read = readFrom(path, from)
      at.offset = read.offset
      const out = summarize(read.lines)
      if (out.length || read.reset) push('ticket-log', { id: t.id, from: read.reset ? 0 : from, reset: read.reset, lines: out })
    }
    // A live plan's logs: the push only says the log grew. The drawer reads it again whole,
    // which is at most 500 lines of two small files.
    for (const p of b.plans.values()) {
      if (!p.live) continue
      let grew = false
      for (const l of p.logs) {
        const path = planLogPath(l.path)
        const key = `plan:${p.run}:${l.step}`
        if (!existsSync(path)) continue
        const size = statSync(path).size
        if (planSizes.get(key) !== size) grew = true
        planSizes.set(key, size)
      }
      if (grew) push('plan-log', { run: p.run })
    }
  }
  const planSizes = new Map<string, number>()

  /**
   * A change to board.jsonl found by its size and mtime, not by fs.watch. A watcher in a
   * long-lived server can stop with no error, and the board then froze while a build ran.
   * The first call only records the file.
   */
  function poll() {
    const stamp = stampOf()
    if (boardStamp !== undefined && stamp !== boardStamp) changed()
    boardStamp = stamp
  }

  function start() {
    mkdirSync(dirname(boardPath), { recursive: true })
    mkdirSync(ticketsDir, { recursive: true })
    const name = basename(boardPath)
    const watchOn = (path: string, o: { recursive?: boolean }, fn: (f: string | null) => void) => {
      const w = watch(path, o, (_, f) => fn(f))
      w.on('error', (err) => console.error(`werk: the board stopped watching ${path}: ${err.message}`))
      watchers.push(w)
    }
    watchOn(dirname(boardPath), {}, (f) => f === name && changed())
    watchOn(ticketsDir, { recursive: true }, changed)
    reap()
    poll()
    const timer = setInterval(() => {
      poll()
      tail()
    }, opts.tailMs ?? 400)
    timer.unref?.()
    return () => {
      clearInterval(timer)
      clearTimeout(boardTimer)
      for (const w of watchers) w.close()
    }
  }

  return { handle, start, children, tail, poll, reap }
}
