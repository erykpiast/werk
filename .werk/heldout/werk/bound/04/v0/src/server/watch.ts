import { mkdirSync, watch, type FSWatcher } from 'node:fs'
import { basename, dirname } from 'node:path'

/**
 * Calls `onChange` each time the log file changes. It watches the directory, not the file,
 * so a log that does not exist yet is seen when the first event creates it.
 */
export function watchLog(path: string, onChange: () => void): FSWatcher {
  const dir = dirname(path)
  const name = basename(path)
  mkdirSync(dir, { recursive: true })
  const watcher = watch(dir, (_event, filename) => {
    // Some platforms do not name the file; a spare refetch is harmless.
    if (filename === null || filename.toString() === name) onChange()
  })
  // A watch that fails, for example because the directory was removed, must not stop the server.
  watcher.on('error', (error) => console.error(`werk: stopped watching ${path}: ${error.message}`))
  return watcher
}
