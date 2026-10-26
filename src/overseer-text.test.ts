import { describe, expect, test } from 'bun:test'
import { askPrompt, descendants, describeToolUse, frozenNote, parseCpuTime, progressPrompt } from './overseer-text.ts'

describe('reading ps', () => {
  test('the TIME column in every form ps prints', () => {
    expect(parseCpuTime('00:00')).toBe(0)
    expect(parseCpuTime('0:01.50')).toBe(1500)
    expect(parseCpuTime('01:02:03')).toBe(3_723_000)
    expect(parseCpuTime('2-01:00:00')).toBe(2 * 86_400_000 + 3_600_000)
  })

  test('only the descendants of the root count, at every depth; short and blank rows are skipped', () => {
    const ps = '\n  1     0   0:00.10\n 10     1   0:01.00\n 11    10   0:00.50\n 12     1   0:09.00\n 13    11   0:00.25\n garbage\n'
    expect(descendants(ps, 10)).toEqual({ cpuMs: 750, pids: [11, 13] })
    expect(descendants(ps, 13)).toEqual({ cpuMs: 0, pids: [] })
    expect(descendants('', 1)).toEqual({ cpuMs: 0, pids: [] })
  })
})

describe('the classifier prompts', () => {
  test('the permission classifier gets the brief, the tool, and the input, cut at 4000 characters', () => {
    const p = askPrompt({ brief: 'Build the list.', tool: 'Bash', input: { command: 'npm install left-pad' } })
    expect(p).toContain('You are the permission classifier')
    expect(p).toContain('## The ticket\n\nBuild the list.')
    expect(p).toContain('Tool: Bash')
    expect(p).toContain('"command": "npm install left-pad"')
    expect(p).toContain('{"allow": true | false')
    const long = askPrompt({ brief: 'b', tool: 'Write', input: { content: 'x'.repeat(10_000) } })
    expect(long.length).toBeLessThan(6000)
  })

  test('the progress classifier gets the calls since the last check, numbered', () => {
    const p = progressPrompt({ brief: 'Build the list.', calls: ['Bash {"command":"make test"}', 'Read {}'] })
    expect(p).toContain('You are the progress classifier')
    expect(p).toContain('Build the list.')
    expect(p).toContain('1. Bash {"command":"make test"}\n2. Read {}')
    expect(p).toContain('{"looping": true | false')
  })

  test('the progress classifier is told which session it watches (#lp-overseer: every session)', () => {
    const calls = ['Read {}']
    expect(progressPrompt({ brief: 'b', calls })).toContain('A builder agent is working on the ticket below.')
    expect(progressPrompt({ brief: 'b', calls, session: 'pass-3' })).toContain('A builder agent is working on the ticket below.')
    const grader = progressPrompt({ brief: 'b', calls, session: 'grade-2' })
    expect(grader).toContain('An agent of the "grade-2" step is checking a builder\'s work on the ticket below.')
    expect(grader).not.toContain('A builder agent')
  })

  test('a killed call\'s note names the tool and gives the evidence (#lp-overseer-inflight)', () => {
    const n = frozenNote({ tool: 'Bash', evidence: { cpuMs: 1234, flatMs: 60_000, pids: [41, 42], runningMs: 75_050 } })
    expect(n).toContain('cancelled this Bash call because it was frozen')
    expect(n).toContain('the call ran for 75.1s')
    expect(n).toContain('(pid 41, 42) used no new CPU time for 60s (total 1.2s)')
    expect(n).toContain('Do not run it again unchanged.')
  })

  test('one line per tool call, with a stand-in name and the input cut at 300 characters', () => {
    expect(describeToolUse({ name: 'Bash', input: { command: 'ls' } })).toBe('Bash {"command":"ls"}')
    expect(describeToolUse({})).toBe('? {}')
    expect(describeToolUse({ name: 'Write', input: { c: 'x'.repeat(1000) } })).toHaveLength('Write '.length + 300)
  })
})
