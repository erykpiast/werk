import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename } from 'node:path'
import { readMap } from '../map/log.ts'
import { childSummary } from './children.ts'
import { sseEvent } from './sse.ts'
import type { Handler, Live } from './state.ts'

/** When this module was last evaluated. A hot reload of this file changes it. */
const handlerLoadedAt = new Date().toISOString()

export const handle: Handler = (req, res, live) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname
  if (req.method === 'GET' && path === '/api/health') {
    return json(res, { ok: true, pid: process.pid, bootId: live.bootId, handlerLoadedAt })
  }
  if (req.method === 'GET' && path === '/api/project') {
    return json(res, { name: basename(live.projectDir) })
  }
  if (req.method === 'GET' && path === '/api/map') return sendMap(res, live)
  if (req.method === 'GET' && path === '/api/live') return openLive(req, res, live)
  if (path.startsWith('/api/')) return json(res, { error: `no route: ${req.method} ${path}` }, 404)
  live.vite.middlewares(req, res)
}

/** The live channel. Its first event describes the server state that survives a reload. */
function openLive(req: IncomingMessage, res: ServerResponse, live: Live): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  res.write(
    sseEvent('hello', {
      pid: process.pid,
      bootId: live.bootId,
      startedAt: live.startedAt,
      children: childSummary(live),
    }),
  )
  live.clients.add(res)
  req.on('close', () => live.clients.delete(res))
}

/** The fold of the project's log: the map as it holds now (#pr-log). */
function sendMap(res: ServerResponse, live: Live): void {
  try {
    json(res, readMap(live.projectDir))
  } catch (error) {
    json(res, { error: (error as Error).message }, 500)
  }
}

function json(res: ServerResponse, body: unknown, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}
