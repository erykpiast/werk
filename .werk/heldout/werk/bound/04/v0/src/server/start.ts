import { randomUUID } from 'node:crypto'
import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { logPath } from '../map/log.ts'
import { handle } from './app.ts'
import { stopChildren } from './children.ts'
import { createClientServer } from './client.ts'
import { LOOPBACK } from './local.ts'
import { changedModules } from './reload.ts'
import { sseEvent } from './sse.ts'
import { liveServer, setLiveServer, type Live } from './state.ts'
import { watchLog } from './watch.ts'

export type StartOptions = { projectDir: string; port: number }

const WERK_ROOT = fileURLToPath(new URL('../..', import.meta.url))

/**
 * Starts the server once per process. Under `bun --hot` an edit evaluates this module
 * again and calls it again. The guard on the global object then keeps the server, its
 * port, its clients and its children, and only swaps in the request handler of the new
 * evaluation. It prints which modules the reload picked up. A change to the start-up code
 * itself takes a restart.
 */
export async function startServer(options: StartOptions): Promise<Live> {
  const running = liveServer()
  if (running) {
    const live = await running
    live.handler = handle
    const changed = changedModules(WERK_ROOT, live.loadedAt)
    live.loadedAt = Date.now()
    console.log(`werk: reloaded ${changed.length ? changed.join(', ') : 'the server modules'}`)
    console.log(`werk: reusing the live server on port ${live.port} (pid ${process.pid}); not listening again`)
    return live
  }
  const booting = boot(options)
  setLiveServer(booting)
  try {
    return await booting
  } catch (error) {
    setLiveServer(undefined)
    throw error
  }
}

async function boot({ projectDir, port }: StartOptions): Promise<Live> {
  const loadedAt = Date.now()
  // Every request goes to the handler of the latest evaluation, through the global slot.
  const server = createServer((req, res) => {
    void liveServer()?.then((live) => live.handler(req, res, live))
  })
  const vite = await createClientServer(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, LOOPBACK, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const clients = new Set<ServerResponse>()
  // The push says only that the log changed. Each page then fetches the fold again.
  const logWatcher = watchLog(logPath(projectDir), () => {
    for (const client of clients) client.write(sseEvent('changed', {}))
  })
  const state: Live = {
    server,
    port: (server.address() as AddressInfo).port,
    projectDir,
    bootId: randomUUID(),
    startedAt: new Date().toISOString(),
    vite,
    clients,
    logWatcher,
    children: new Map(),
    handler: handle,
    loadedAt,
  }
  const stop = () => {
    stopChildren(state)
    logWatcher.close()
    for (const client of state.clients) client.end()
    void vite.close()
    server.close()
    process.exit(0)
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  console.log(`werk: serving ${projectDir} at http://localhost:${state.port} (pid ${process.pid})`)
  return state
}
