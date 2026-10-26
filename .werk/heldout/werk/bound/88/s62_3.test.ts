import { expect, test } from "bun:test";
import { card, lines, ok, withMap } from "./h62util.ts";

test("62.3 the words of a ghost are frozen", async () => {
  const p = withMap([card("root", "Root")]);
  await ok(p, ["add", "log", "--title", "Use a log", "--parent", "root"]);
  const before = lines(p);
  const edit = await p.werk(["edit", "log", "--body", "A new body"]);
  expect(edit.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  const retitle = await p.werk(["retitle", "log", "Use an append-only log"]);
  expect(retitle.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  const again = await p.werk(["add", "log", "--title", "A different title", "--parent", "root"]);
  expect(again.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  const show = (await ok(p, ["show", "log"])).out;
  expect(show).toContain("Use a log");
  expect(show).not.toContain("append-only");
  expect(show).not.toContain("A different title");
  expect(show).toContain("proposed");
}, 30_000);
