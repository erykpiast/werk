/**
 * Runs after `bun test --coverage`. Reads the lcov report and exits 1 when a pure file is
 * under the threshold. Usage: bun tools/coverage-gate.ts <lcov file>
 */
import { existsSync, readFileSync } from 'node:fs'
import { checkGate, formatGate, parseLcov } from './coverage.ts'
import { PURE_FILES, THRESHOLD } from './pure-files.ts'

const path = process.argv[2] ?? 'coverage/lcov.info'
if (!existsSync(path)) {
  console.error(`coverage gate: no report at ${path}. Run the tests with coverage first.`)
  process.exit(1)
}
const result = checkGate(parseLcov(readFileSync(path, 'utf8')), PURE_FILES, THRESHOLD)
console.log(formatGate(result, THRESHOLD))
process.exit(result.ok ? 0 : 1)
