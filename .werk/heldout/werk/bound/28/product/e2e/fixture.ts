import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { realpathSync } from 'node:fs'

/**
 * Where the browser tests' server keeps its copy of the fixture project. It depends only on
 * the port, so a browser test can run werk commands in the same project the page shows.
 */
export function fixtureRoot(port: number | string): string {
  return join(realpathSync(tmpdir()), `werk-e2e-${port}`)
}

export function fixtureProject(port: number | string): string {
  return join(fixtureRoot(port), 'demo')
}
