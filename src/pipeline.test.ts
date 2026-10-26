import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendPipeline, appendPipelineMany, foldPasses, readPipeline } from './pipeline.ts'
import type { PipelineEvent } from './pipeline.ts'

const scratch = () => join(mkdtempSync(join(tmpdir(), 'werk-pipeline-')), '.werk', 'pipeline.jsonl')

describe('the pipeline log', () => {
  test('a missing log reads as empty; appends number their events from 1, in the decision log shape', () => {
    const path = scratch()
    expect(readPipeline(path)).toEqual([])
    appendPipeline('step.started', { build: 'B', ticket: 't', step: 'build', cap: 3 }, { path, at: 'a1' })
    appendPipeline('step.ended', { build: 'B', ticket: 't', step: 'build', ms: 5, result: 'green' }, { path })
    const events = readPipeline(path)
    expect(events.map((e) => [e.seq, e.actor, e.type])).toEqual([
      [1, 'agent', 'step.started'],
      [2, 'agent', 'step.ended'],
    ])
    expect(events[0].at).toBe('a1')
  })

  test('a broken line names the file and the line', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'werk-pipeline-')), 'p.jsonl')
    writeFileSync(path, '{"seq":1}\nnot json\n')
    expect(() => readPipeline(path)).toThrow(`${path}:2 is not valid JSON`)
  })

  test('an empty file appends from seq 1', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'werk-pipeline-')), 'p.jsonl')
    writeFileSync(path, '')
    expect(appendPipeline('step.started', { build: 'B', ticket: 't', step: 'build' }, { path }).seq).toBe(1)
  })

  test('a batch append numbers its events after the last one, in order, and returns the count', () => {
    const path = scratch()
    appendPipeline('step.started', { build: 'B', ticket: 't', step: 'build' }, { path })
    const n = appendPipelineMany(
      [
        { type: 'step.started', payload: { build: 'B', ticket: 't', step: 'pass', pass: 1 }, at: 'b1' },
        { type: 'step.ended', payload: { build: 'B', ticket: 't', step: 'build', ms: 3, result: 'green' }, at: 'b2' },
      ],
      path,
    )
    expect(n).toBe(2)
    expect(readPipeline(path).map((e) => [e.seq, e.at, e.actor, e.type])).toEqual([
      [1, expect.any(String), 'agent', 'step.started'],
      [2, 'b1', 'agent', 'step.started'],
      [3, 'b2', 'agent', 'step.ended'],
    ])
  })

  test('a batch into a new log starts at seq 1; an empty batch writes nothing', () => {
    const path = scratch()
    expect(appendPipelineMany([], path)).toBe(0)
    expect(readPipeline(path)).toEqual([])
    appendPipelineMany([{ type: 'step.started', payload: { build: 'B', ticket: 't', step: 'build' }, at: 'x' }], path)
    expect(readPipeline(path).map((e) => e.seq)).toEqual([1])
  })
})

describe('foldPasses', () => {
  let seq = 0
  const ev = (type: PipelineEvent['type'], payload: Record<string, unknown>, at = `t${seq}`): PipelineEvent => ({ seq: ++seq, at, actor: 'agent', type, payload: payload as never })

  test('one pass per pass-ended event, with its start time, the cap of its build, and the cost of its sessions', () => {
    const passes = foldPasses([
      ev('step.started', { build: 'B', ticket: 't', step: 'build', cap: 4 }),
      ev('step.started', { build: 'B', ticket: 't', step: 'pass', pass: 1 }, 'start-1'),
      ev('step.ended', { build: 'B', ticket: 't', step: 'session', pass: 1, name: 'pass-1', ms: 1, result: 'ok', costUsd: 0.25 }),
      ev('step.ended', { build: 'B', ticket: 't', step: 'session', pass: 1, name: 'grade-1', ms: 1, result: 'ok', costUsd: 0.5 }),
      ev('step.ended', { build: 'B', ticket: 't', step: 'session', pass: 1, name: 'review-1', ms: 1, result: 'error' }),
      ev('step.ended', { build: 'B', ticket: 't', step: 'check', pass: 1, name: 'make', ms: 1, result: 'ok' }),
      ev('step.ended', { build: 'B', ticket: 't', step: 'pass', pass: 1, ms: 9, result: 'red', pass_end: { green: false, failure: 'grade', grade: [1] } }),
      // A pass with no pass_end, and a session outside any pass, are not passes.
      ev('step.ended', { build: 'B', ticket: 't', step: 'pass', pass: 2, ms: 1, result: 'stopped' }),
      ev('step.ended', { build: 'B', ticket: 't', step: 'session', name: 'x', ms: 1, result: 'ok', costUsd: 9 }),
      ev('step.ended', { build: 'B', ticket: 't', step: 'build', ms: 20, result: 'stopped' }),
    ])
    expect(passes).toEqual([{ green: false, failure: 'grade', grade: [1], ticket: 't', loopRun: 'B', pass: 1, at: 'start-1', ms: 9, cap: 4, costUsd: 0.75 }])
  })

  test('a pass with no started event takes the time of its end, and a pass with no session costs nothing', () => {
    const [p] = foldPasses([ev('step.ended', { build: 'C', ticket: 't', step: 'pass', pass: 1, ms: 2, result: 'green', pass_end: { green: true } }, 'end')])
    expect(p).toMatchObject({ at: 'end', costUsd: 0, cap: undefined })
  })
})
