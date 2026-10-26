/**
 * The server start-up as the dev command runs it, plus one long-lived child held by the
 * server, the way a chat agent will be. The hot-reload test runs this under `bun --hot`.
 */
import { holdChild } from '../src/server/children.ts'
import { startServer } from '../src/server/start.ts'

const live = await startServer({ projectDir: process.cwd(), port: 0 })
holdChild(live, 'agent', 'claude', ['--print'], { env: process.env })
