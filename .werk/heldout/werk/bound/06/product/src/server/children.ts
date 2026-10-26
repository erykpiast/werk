import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import type { Live } from './state.ts'

/**
 * Starts a long-lived child under a name, or returns the one already running under it.
 * The registry is on the live server, so a hot reload that runs this again gets the same
 * child back, not a second one.
 */
export function holdChild(live: Live, name: string, command: string, args: readonly string[], options: SpawnOptions = {}): ChildProcess {
  const running = live.children.get(name)
  if (running && isRunning(running)) return running
  const child = spawn(command, args, { stdio: 'ignore', ...options })
  live.children.set(name, child)
  // A child that fails to start emits 'error' and never 'exit'.
  const forget = () => {
    if (live.children.get(name) === child) live.children.delete(name)
  }
  child.on('exit', forget)
  child.on('error', forget)
  return child
}

export function isRunning(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null
}

export function childSummary(live: Live): { name: string; pid: number | undefined }[] {
  return [...live.children].map(([name, child]) => ({ name, pid: child.pid }))
}

export function stopChildren(live: Live): void {
  for (const child of live.children.values()) child.kill('SIGTERM')
  live.children.clear()
}
