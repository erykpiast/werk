import type { ChildProcess } from 'node:child_process'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { ViteDevServer } from 'vite'

export type Handler = (req: IncomingMessage, res: ServerResponse, live: Live) => void

/**
 * Everything that must outlive a hot reload. It sits on the global object, because
 * `bun --hot` evaluates every module again on an edit but keeps the global object.
 * A module that holds a socket, a child or a client list in its own scope loses it on reload.
 */
export type Live = {
  readonly server: Server
  readonly port: number
  readonly projectDir: string
  readonly bootId: string
  readonly startedAt: string
  readonly vite: ViteDevServer
  /** Open connections to the live channel. */
  readonly clients: Set<ServerResponse>
  /** Long-lived children, by name. A reload reuses them; it never starts a second one. */
  readonly children: Map<string, ChildProcess>
  /** The request handler of the latest evaluation. A reload swaps it in. */
  handler: Handler
}

const slot = globalThis as { __werkLive?: Promise<Live> }

export function liveServer(): Promise<Live> | undefined {
  return slot.__werkLive
}

export function setLiveServer(live: Promise<Live> | undefined): void {
  slot.__werkLive = live
}
