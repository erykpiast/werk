// The two live halves of #werk-hmr-swap-serve-reexec: the parent that waits on its child, and
// the child that stops when its parent is gone. The decision of who plays which half is in
// hot-reexec.ts.
import { spawn } from 'node:child_process'
import { alive } from './board-routes.ts'

/** Run the child, pass the stop signals to it, and resolve with its exit code. A child that
 *  a signal ended counts as 1. */
export function runChild(command: string[], env: Record<string, string>): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), { env, stdio: 'inherit' })
    const pass = (sig: NodeJS.Signals) => () => child.kill(sig)
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(sig, pass(sig))
    child.on('error', () => resolve(1))
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

/** Check twice a second that the parent lives, and call `stop` once it does not. Returns
 *  the timer so a test can end it. */
export function watchParent(parent: number, stop: () => void, isAlive: (pid: number) => boolean = alive, everyMs = 500): ReturnType<typeof setInterval> {
  const timer = setInterval(() => {
    if (isAlive(parent)) return
    clearInterval(timer)
    stop()
  }, everyMs)
  timer.unref?.()
  return timer
}
