import { expect, test } from "bun:test";
import { parseDrops } from "./drops.ts";

test("a list of tickets with reasons parses", () => {
  expect(parseDrops('[{"ticket": 3, "why": " not asked for "}]')).toEqual({
    ok: true,
    drops: [{ ticket: 3, why: "not asked for" }],
  });
  expect(parseDrops("[]")).toEqual({ ok: true, drops: [] });
});

test("text that is not a list, or an item without a number or a reason, is refused with the reason", () => {
  expect(parseDrops("{")).toMatchObject({ ok: false });
  expect(parseDrops("{}")).toEqual({ ok: false, error: "not a JSON list" });
  expect(parseDrops('[{"why": "x"}]')).toEqual({
    ok: false,
    error: "item 1 needs a ticket number",
  });
  expect(parseDrops('[{"ticket": 0, "why": "x"}]')).toMatchObject({
    ok: false,
  });
  expect(parseDrops("[null]")).toMatchObject({ ok: false });
  expect(parseDrops('[{"ticket": 2, "why": " "}]')).toEqual({
    ok: false,
    error: "item 1 needs a why",
  });
});
