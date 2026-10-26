import { expect, test } from 'bun:test'
import { isJsonBody, isLocalHost, isLocalOrigin } from './local.ts'

test('only the loopback names on the server port count as a local host', () => {
  expect(isLocalHost('localhost:4747', 4747)).toBe(true)
  expect(isLocalHost('127.0.0.1:4747', 4747)).toBe(true)
  expect(isLocalHost('LOCALHOST:4747', 4747)).toBe(true)
  expect(isLocalHost('localhost:4748', 4747)).toBe(false)
  expect(isLocalHost('localhost', 4747)).toBe(false)
  expect(isLocalHost('evil.example:4747', 4747)).toBe(false)
  expect(isLocalHost(undefined, 4747)).toBe(false)
})

test('a request with no Origin, or a page werk served, counts as a local origin', () => {
  expect(isLocalOrigin(undefined, 4747)).toBe(true)
  expect(isLocalOrigin('http://localhost:4747', 4747)).toBe(true)
  expect(isLocalOrigin('http://127.0.0.1:4747', 4747)).toBe(true)
  expect(isLocalOrigin('https://localhost:4747', 4747)).toBe(false)
  expect(isLocalOrigin('http://localhost:4748', 4747)).toBe(false)
  expect(isLocalOrigin('https://evil.example', 4747)).toBe(false)
  expect(isLocalOrigin('null', 4747)).toBe(false)
})

test('only application/json, with or without parameters, counts as a JSON body', () => {
  expect(isJsonBody('application/json')).toBe(true)
  expect(isJsonBody('Application/JSON; charset=utf-8')).toBe(true)
  expect(isJsonBody('text/plain')).toBe(false)
  expect(isJsonBody('application/x-www-form-urlencoded')).toBe(false)
  expect(isJsonBody(undefined)).toBe(false)
})
