// Puts the fake agent first on PATH for this process, the way v0/test/setup.ts does, without
// the happy-dom globals (the browser here is a real Chromium).
import { testEnv } from '../v0/test/env.ts'
for (const key of Object.keys(process.env)) if (key.startsWith('WERK_')) delete process.env[key]
process.env.PATH = testEnv().PATH
