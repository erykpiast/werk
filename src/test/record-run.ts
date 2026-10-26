// Run after `bun test`: folds the junit report into one line of the test-run record
// (#vi-flow-ms-tests). It never fails the test run: a missing report is a run that crashed
// before it wrote one, and the test command's own exit code already says that.
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { appendRun, parseJunit } from '../test-runs.ts'

const report = process.argv[2] ?? '.werk/test-run.xml'
if (!existsSync(report)) process.exit(0)
appendRun(parseJunit(readFileSync(report, 'utf8'), new Date().toISOString()))
// A later run that crashes before it writes a report must not record this one again.
rmSync(report, { force: true })
