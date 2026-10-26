import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { basename } from 'node:path'
import { appendEvent, logPath, readMap } from '../map/log.ts'
import { sendTurn } from './chat.ts'
import { childSummary } from './children.ts'
import { isJsonBody, isLocalHost, isLocalOrigin } from './local.ts'
import { sseEvent } from './sse.ts'
import type { Handler, Live } from './state.ts'

/** When this module was last evaluated. A hot reload of this file changes it. */
const handlerLoadedAt = new Date().toISOString()

export const handle: Handler = (req, res, live) => {
  if (!isLocalHost(req.headers.host, live.port)) return json(res, { error: 'werk answers on localhost only' }, 403)
  const path = new URL(req.url ?? '/', 'http://localhost').pathname
  if (req.method === 'GET' && path === '/api/health') {
    const { address: host } = live.server.address() as AddressInfo
    return json(res, { ok: true, pid: process.pid, bootId: live.bootId, handlerLoadedAt, host })
  }
  if (req.method === 'GET' && path === '/api/project') {
    return json(res, { name: basename(live.projectDir) })
  }
  if (req.method === 'GET' && path === '/api/map') return sendMap(res, live)
  if (req.method === 'GET' && path === '/api/live') return openLive(req, res, live)
  if (req.method === 'POST' && path === '/api/chat') return void postChat(req, res, live)
  if (req.method === 'POST' && path === '/api/accept') return void postAccept(req, res, live)
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

/** One user turn for the chat agent. The reply streams on the live channel. */
async function postChat(req: IncomingMessage, res: ServerResponse, live: Live): Promise<void> {
  if (!isLocalOrigin(req.headers.origin, live.port)) return json(res, { error: 'a chat turn must come from a page werk served' }, 403)
  if (!isJsonBody(req.headers['content-type'])) return json(res, { error: 'the content type must be application/json' }, 415)
  let text: unknown
  try {
    text = (JSON.parse(await readBody(req)) as { text?: unknown }).text
  } catch {
    return json(res, { error: 'the body must be JSON: {"text": "..."}' }, 400)
  }
  if (typeof text !== 'string' || !text.trim()) return json(res, { error: 'text must be a non-empty string' }, 400)
  try {
    json(res, { pid: sendTurn(live, text).pid })
  } catch (error) {
    json(res, { error: (error as Error).message }, 502)
  }
}

/**
 * The ✓ on a ghost (#werk-propose-new): appends one accept event for one ghost, and the page
 * redraws from the log (#werk-write). It takes exactly one id, so no click accepts a batch.
 */
async function postAccept(req: IncomingMessage, res: ServerResponse, live: Live): Promise<void> {
  if (!isLocalOrigin(req.headers.origin, live.port)) return json(res, { error: 'an accept must come from a page werk served' }, 403)
  if (!isJsonBody(req.headers['content-type'])) return json(res, { error: 'the content type must be application/json' }, 415)
  let id: unknown
  try {
    id = (JSON.parse(await readBody(req)) as { id?: unknown }).id
  } catch {
    return json(res, { error: 'the body must be JSON: {"id": "..."}' }, 400)
  }
  if (typeof id !== 'string' || !id) return json(res, { error: 'id must be the id of one ghost' }, 400)
  const result = appendEvent(logPath(live.projectDir), { type: 'accepted', id })
  if (!result.ok) return json(res, { error: result.message }, 409)
  json(res, { seq: result.event.seq })
}

async function readBody(req: IncomingMessage): Promise<string> {
  let body = ''
  for await (const chunk of req) body += chunk
  return body
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
