import { readdirSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'

/**
 * The server modules saved after `sinceMs`: the files a hot reload picked up. Paths are
 * relative to the werk root. Tests and the client are left out: the server never imports
 * them, so a change there does not reload the server.
 */
export function changedModules(werkRoot: string, sinceMs: number): string[] {
  return readdirSync(join(werkRoot, 'src'), { recursive: true, encoding: 'utf8' })
    .map((path) => join('src', path))
    .filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path) && !path.startsWith(join('src', 'client') + sep))
    .filter((path) => statSync(join(werkRoot, path)).mtimeMs > sinceMs)
    .sort()
}
