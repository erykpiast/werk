// The globals rule from #werk-test-globals, as the preload in test/setup.ts meets it for
// werk (#werk-test-dom). Server code and component code share one process here.
import { describe, expect, test } from 'bun:test'

describe('each test sees the globals its own code expects', () => {
  test('a server test reaches a local server with the runtime fetch', async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response('ok') })
    try {
      const res = await fetch(`http://localhost:${server.port}/`)
      expect(await res.text()).toBe('ok')
    } finally {
      server.stop(true)
    }
  })

  test('a component test finds a document', () => {
    const button = document.createElement('button')
    button.textContent = 'Accept'
    document.body.append(button)
    expect(document.querySelector('button')?.textContent).toBe('Accept')
  })

  test('the next test starts with an empty document', () => {
    expect(document.body.children.length).toBe(0)
  })

  test('timers and streams are the runtime ones', async () => {
    await new Promise(resolve => setTimeout(resolve, 1))
    const text = await new Response(new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode('x')); c.close() },
    })).text()
    expect(text).toBe('x')
  })
})
