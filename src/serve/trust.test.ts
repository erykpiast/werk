import { expect, test } from "bun:test";
import { isLoopbackHost, judgeRequest } from "./trust.ts";

const base = {
  method: "POST",
  host: "localhost:4000",
  token: "t",
  expected: "t",
};

test("a loopback name is trusted with or without a port, and any other name is not", () => {
  for (const host of [
    "localhost",
    "LOCALHOST:4000",
    "127.0.0.1:1",
    "[::1]:80",
    "[::1]",
  ]) {
    expect(isLoopbackHost(host)).toBe(true);
  }
  for (const host of [
    null,
    "",
    "evil.com",
    "localhost.evil.com",
    "127.0.0.1.evil.com:80",
    "10.0.0.2",
  ]) {
    expect(isLoopbackHost(host)).toBe(false);
  }
});

test("a read-only request from a loopback host needs no token", () => {
  expect(judgeRequest({ ...base, method: "GET", token: null }).ok).toBe(true);
  expect(judgeRequest({ ...base, method: "head", token: null }).ok).toBe(true);
});

test("a changing request needs the token that the server made", () => {
  expect(judgeRequest(base).ok).toBe(true);
  expect(judgeRequest({ ...base, token: null }).ok).toBe(false);
  expect(judgeRequest({ ...base, token: "other" }).ok).toBe(false);
  expect(judgeRequest({ ...base, method: "DELETE", token: null }).ok).toBe(
    false,
  );
});

test("a non-loopback Host is refused even for a read and even with the token", () => {
  expect(judgeRequest({ ...base, method: "GET", host: "evil.com" }).ok).toBe(
    false,
  );
  expect(judgeRequest({ ...base, host: "evil.com" }).ok).toBe(false);
  expect(judgeRequest({ ...base, host: null }).ok).toBe(false);
});
