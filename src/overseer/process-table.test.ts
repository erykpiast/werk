import { expect, test } from "bun:test";
import { childrenOf, parseCpuTime } from "./process-table.ts";

test("parseCpuTime reads the forms of ps", () => {
  expect(parseCpuTime("0:01.50")).toBe(1500);
  expect(parseCpuTime("01:02")).toBe(62_000);
  expect(parseCpuTime("1:02:03")).toBe(3_723_000);
  expect(parseCpuTime("2-00:00:01")).toBe(172_801_000);
  expect(parseCpuTime("soon")).toBeNull();
});

test("childrenOf sums every descendant of the root, not the root", () => {
  const table = [
    "10 1 00:05",
    "12 11 00:03",
    "11 10 00:02",
    "13 10 00:01",
    "20 1 09:00",
  ].join("\n");
  expect(childrenOf(table, 10)).toEqual({
    ok: true,
    processes: 3,
    cpuMs: 6000,
  });
});

test("a table without the root is a read that found no process", () => {
  expect(childrenOf("20 1 00:01\n", 10)).toEqual({
    ok: true,
    processes: 0,
    cpuMs: 0,
  });
});

test("an empty table or an unreadable row is a failed read", () => {
  expect(childrenOf("", 10).ok).toBe(false);
  const bad = childrenOf("10 1 00:01\nnot a row\n", 10);
  expect(bad.ok).toBe(false);
  expect(bad.ok === false && bad.why).toContain("not a row");
});
