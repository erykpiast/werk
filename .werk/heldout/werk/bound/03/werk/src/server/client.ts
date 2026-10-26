import type { Server } from 'node:http'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { createServer, type ViteDevServer } from 'vite'

export const CLIENT_ROOT = fileURLToPath(new URL('../client', import.meta.url))

/** Vite in middleware mode, inside werk's own server: it transforms the React client. */
export function createClientServer(httpServer: Server): Promise<ViteDevServer> {
  return createServer({
    configFile: false,
    root: CLIENT_ROOT,
    appType: 'spa',
    logLevel: 'warn',
    clearScreen: false,
    plugins: [react()],
    server: { middlewareMode: true, hmr: { server: httpServer } },
  })
}
