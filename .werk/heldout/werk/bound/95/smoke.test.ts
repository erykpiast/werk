import { test, expect } from 'bun:test'
import { makeProject } from '../src/test/harness.ts'
test('smoke', () => { const p = makeProject(); const r = p.werk(['help']); console.log(r.stdout, r.stderr); expect(r.code).toBe(0) })
