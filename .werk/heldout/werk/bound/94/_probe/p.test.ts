import { test, expect } from 'bun:test'
import { makeProject } from '../../src/test/harness.ts'
test('probe', () => { const p = makeProject(); const r = p.werk(['help']); expect(r.code).toBe(0); p.cleanup() })
