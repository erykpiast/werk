#!/usr/bin/env bun
import { parseArgs, USAGE } from './args.ts'
import { describeEvent } from './map/events.ts'
import { changesSinceDecided, fold } from './map/fold.ts'
import { appendEvents, logPath, readLog } from './map/log.ts'
import { pageOf } from './map/view.ts'
import { startServer } from './server/start.ts'

const command = parseArgs(process.argv.slice(2))

switch (command.kind) {
  case 'help':
    console.log(USAGE)
    break
  case 'error':
    console.error(`werk: ${command.message}\n\n${USAGE}`)
    process.exit(1)
    break
  case 'show': {
    const events = readLog(logPath(process.cwd()))
    const map = fold(events)
    const page = pageOf(map, command.id)
    if (!page) {
      console.error(`werk: no card #${command.id} in the map`)
      process.exit(1)
    }
    // The root page carries the refused log lines; a card page carries what changed since its decide.
    const extra = command.id === undefined ? { problems: map.problems } : { changedSinceDecided: changesSinceDecided(events, command.id).map(describeEvent) }
    console.log(JSON.stringify({ ...page, ...extra }, null, 2))
    break
  }
  case 'write': {
    const result = appendEvents(logPath(process.cwd()), command.events)
    if (!result.ok) {
      console.error(`werk: ${result.message}`)
      process.exit(1)
    }
    for (const event of result.events) console.log(describeEvent(event))
    break
  }
  case 'serve':
    await startServer({ projectDir: process.cwd(), port: command.port })
    break
}
