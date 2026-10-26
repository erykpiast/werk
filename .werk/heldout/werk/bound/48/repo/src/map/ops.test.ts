import { describe, expect, test } from "bun:test";
import { applyOps, blocksOf, diffOf, type Op, opsRule, uncovered } from "./ops.ts";

const fence = "```sh\nwerk show x\n\nwerk accept x\n```";
const body = `We charge per seat.\n\n- monthly\n- yearly\n\n\n${fence}\n`;

describe("the blocks of a body", () => {
  test("cut at each run of blank lines outside a fence, trimmed at both ends", () => {
    expect(blocksOf(body)).toEqual(["We charge per seat.", "- monthly\n- yearly", fence]);
  });

  test("an empty or missing body has no blocks, and lines of spaces count as blank", () => {
    expect(blocksOf(undefined)).toEqual([]);
    expect(blocksOf("  \n\n")).toEqual([]);
    expect(blocksOf("a\n   \nb")).toEqual(["a", "b"]);
  });

  test("a tilde fence closes only on a tilde fence, and an unclosed fence runs to the end", () => {
    expect(blocksOf("~~~\na\n\n```\n\nb\n~~~\n\nc")).toEqual(["~~~\na\n\n```\n\nb\n~~~", "c"]);
    expect(blocksOf("```\na\n\nb")).toEqual(["```\na\n\nb"]);
  });
});

describe("the cover rule", () => {
  test("lists each block that no elaborated or removed op names", () => {
    const ops: Op[] = [
      { tag: "elaborated", old: "We charge per seat.", new: "We charge per seat, per month." },
      { tag: "removed", old: " - monthly\n- yearly " },
      { tag: "new", new: fence },
    ];
    expect(uncovered(body, ops)).toEqual([fence]);
  });

  test("two equal blocks need two ops", () => {
    const twice = "Same.\n\nSame.";
    expect(uncovered(twice, [{ tag: "removed", old: "Same." }])).toEqual(["Same."]);
    expect(
      uncovered(twice, [
        { tag: "removed", old: "Same." },
        { tag: "elaborated", old: "Same.", new: "Same." },
      ]),
    ).toEqual([]);
  });
});

describe("the diff", () => {
  test("marks kept, elaborated, new and removed blocks in the order of the ops", () => {
    const ops: Op[] = [
      { tag: "elaborated", old: "We charge per seat.", new: "We charge per seat." },
      { tag: "elaborated", old: "- monthly\n- yearly", new: "- yearly" },
      { tag: "removed", old: fence },
      { tag: "new", new: "Seats are counted daily." },
    ];
    expect(diffOf(body, ops)).toEqual([
      { mark: "kept", text: "We charge per seat." },
      { mark: "elaborated", old: "- monthly\n- yearly", new: "- yearly" },
      { mark: "removed", old: fence },
      { mark: "new", new: "Seats are counted daily." },
    ]);
  });

  test("an old that quotes no real block shows as removed plus new, and is never trusted", () => {
    const ops: Op[] = [
      { tag: "elaborated", old: "We charge per user.", new: "We charge per team." },
      { tag: "removed", old: "Not in the body." },
    ];
    expect(diffOf("We charge per seat.", ops)).toEqual([
      { mark: "removed", old: "We charge per user.", unquoted: true },
      { mark: "new", new: "We charge per team." },
      { mark: "removed", old: "Not in the body.", unquoted: true },
    ]);
  });

  test("an old quotes one block once, so a second quote of the same single block is not trusted", () => {
    const ops: Op[] = [
      { tag: "removed", old: "A" },
      { tag: "removed", old: "A" },
    ];
    expect(diffOf("A", ops)).toEqual([
      { mark: "removed", old: "A" },
      { mark: "removed", old: "A", unquoted: true },
    ]);
  });
});

describe("applying the ops", () => {
  test("rebuilds the body from the new text of each op, in order, one blank line apart", () => {
    const ops: Op[] = [
      { tag: "new", new: "First." },
      { tag: "elaborated", old: "We charge per seat.", new: " Per seat, monthly. " },
      { tag: "removed", old: "- monthly\n- yearly" },
      { tag: "elaborated", old: fence, new: fence },
    ];
    expect(applyOps(body, ops)).toBe(`First.\n\nPer seat, monthly.\n\n${fence}`);
  });

  test("an unquoted elaborated op still adds its new text, and an unquoted removal changes nothing", () => {
    const ops: Op[] = [
      { tag: "elaborated", old: "Z", new: "B" },
      { tag: "removed", old: "Nowhere" },
      { tag: "elaborated", old: "C", new: "C" },
    ];
    expect(applyOps("C", ops)).toBe("B\n\nC");
  });

  test("removing every block leaves an empty body", () => {
    expect(applyOps("A", [{ tag: "removed", old: "A" }])).toBe("");
  });
});

describe("the shape of an op list", () => {
  test("is a list of ops, each with its tag and its texts", () => {
    expect(opsRule([{ tag: "new", new: "x" }])).toBeUndefined();
    expect(
      opsRule([
        { tag: "elaborated", old: "a", new: "b" },
        { tag: "removed", old: "a" },
      ]),
    ).toBeUndefined();
    expect(opsRule({})).toBe("the ops are a list");
    expect(opsRule([null])).toBe("op 1 is an object with a tag: elaborated, new or removed");
    expect(opsRule([{ tag: "moved" }])).toBe("op 1 is an object with a tag: elaborated, new or removed");
    expect(opsRule([{ tag: "new" }])).toBe("op 1, new, needs its new text");
    expect(opsRule([{ tag: "new", new: "x" }, { tag: "removed" }])).toBe("op 2, removed, needs its old text");
    expect(opsRule([{ tag: "elaborated", old: "a" }])).toBe("op 1, elaborated, needs its new text");
    expect(opsRule([{ tag: "elaborated", new: "a" }])).toBe("op 1, elaborated, needs its old text");
  });
});
