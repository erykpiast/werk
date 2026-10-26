/**
 * werk serves one user on one machine. A chat turn starts a `claude` child with the user's
 * credentials, so only a page that werk itself served may send one.
 */

/** The interface the server listens on. Another host on the network cannot connect. */
export const LOOPBACK = '127.0.0.1'

const localHosts = (port: number) => [`localhost:${port}`, `${LOOPBACK}:${port}`]

/**
 * True when the Host header names this server. Any other name means a DNS rebinding page
 * that reached the loopback port under its own origin.
 */
export function isLocalHost(host: string | undefined, port: number): boolean {
  return host !== undefined && localHosts(port).includes(host.toLowerCase())
}

/** True when a request with this Origin header may change state. No header: not a browser page. */
export function isLocalOrigin(origin: string | undefined, port: number): boolean {
  if (origin === undefined) return true
  return localHosts(port).some((host) => origin.toLowerCase() === `http://${host}`)
}

/**
 * True for a JSON body. A cross-origin page can send `text/plain` with no preflight; it
 * cannot send `application/json` without one, and werk never grants a preflight.
 */
export function isJsonBody(contentType: string | undefined): boolean {
  return contentType?.split(';')[0]?.trim().toLowerCase() === 'application/json'
}
