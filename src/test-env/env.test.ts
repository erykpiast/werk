import { expect, test } from "bun:test";
import { delimiter } from "node:path";
import { cleanEnv, fakeIsFirst, pathWithFake } from "./env.ts";

test("cleanEnv removes every werk variable and puts the fake folder first", () => {
  const env = cleanEnv(
    {
      WERK_LOG: "/real/log",
      WERK_BOARD: "/real/board",
      HOME: "/h",
      PATH: "/usr/bin",
    },
    "/fake",
  );
  expect(env).toEqual({ HOME: "/h", PATH: `/fake${delimiter}/usr/bin` });
});

test("pathWithFake keeps one copy of the fake folder, at the front", () => {
  expect(pathWithFake(["/a", "/fake", "/b"].join(delimiter), "/fake")).toBe(
    ["/fake", "/a", "/b"].join(delimiter),
  );
  expect(pathWithFake(undefined, "/fake")).toBe("/fake");
});

test("fakeIsFirst is true only for the first entry", () => {
  expect(fakeIsFirst(["/fake", "/a"].join(delimiter), "/fake")).toBe(true);
  expect(fakeIsFirst(["/a", "/fake"].join(delimiter), "/fake")).toBe(false);
  expect(fakeIsFirst(undefined, "/fake")).toBe(false);
});
