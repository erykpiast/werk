import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { handle } from './app.ts'
import { stopChildren } from './children.ts'
import { createClientServer } from './client.ts'
import { liveServer, setLiveServer, type Live } from './state.ts'

export type StartOptions = { projectDir: string; port: number }

/**
 * Starts the server once per process. Under `bun --hot` an edit evaluates this module
 * again and calls it again. The guard on the global object then keeps the server, its
 * port, its clients and its children, and only swaps in the request handler of the new
 * evaluation. A change to the start-up code itself takes a restart.
 */
export async function startServer(options: StartOptions): Promise<Live> {
  const running = liveServer()
  if (running) {
    const live = await running
    live.handler = handle
    console.log(`werk: reusing the live server on port ${live.port} (pid ${process.pid})`)
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
  // Every request goes to the handler of the latest evaluation, through the global slot.
  const server = createServer((req, res) => {
    void liveServer()?.then((live) => live.handler(req, res, live))
  })
  const vite = await createClientServer(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const state: Live = {
    server,
    port: (server.address() as AddressInfo).port,
    projectDir,
    bootId: randomUUID(),
    startedAt: new Date().toISOString(),
    vite,
    clients: new Set(),
    children: new Map(),
    handler: handle,
  }
  const stop = () => {
    stopChildren(state)
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
