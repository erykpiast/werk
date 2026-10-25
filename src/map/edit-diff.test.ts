import { describe, expect, test } from "bun:test";
import {
  applyOps,
  bodyDiff,
  checkOps,
  type Op,
  parseOps,
  renderPending,
  splitBlocks,
  wordDiff,
} from "./edit-diff.ts";

describe("splitBlocks", () => {
  test("cuts at blank lines, keeps a list as one block, and trims the ends", () => {
    const body = "We charge per seat.\n\n\n- monthly\n- yearly\n\n  tail  \n";
    expect(splitBlocks(body)).toEqual([
      "We charge per seat.",
      "- monthly\n- yearly",
      "tail",
    ]);
  });

  test("a blank line inside a code fence does not cut", () => {
    const fence = "```sh\nwerk show x\n\nwerk accept x\n```";
    expect(splitBlocks(`P\n\n${fence}`)).toEqual(["P", fence]);
  });

  test("an empty body has no block", () => {
    expect(splitBlocks("  \n\n")).toEqual([]);
  });
});

describe("parseOps", () => {
  test("reads the three tags and trims their text", () => {
    expect(
      parseOps([
        { tag: "elaborated", old: " a ", new: "b " },
        { tag: "new", new: "c" },
        { tag: "removed", old: "d" },
      ]),
    ).toEqual([
      { tag: "elaborated", old: "a", new: "b" },
      { tag: "new", new: "c" },
      { tag: "removed", old: "d" },
    ]);
  });

  test("names what is wrong with a value that is not a list of ops", () => {
    expect(parseOps("x")).toContain("list");
    expect(parseOps(["x"])).toContain("op 1");
    expect(parseOps([null])).toContain("op 1");
    expect(parseOps([{ tag: "swap" }])).toContain("swap");
    expect(parseOps([{ tag: "elaborated", old: "a" }])).toContain('"new"');
    expect(parseOps([{ tag: "elaborated", new: "a" }])).toContain('"old"');
    expect(parseOps([{ tag: "new", new: " " }])).toContain('"new"');
    expect(parseOps([{ tag: "removed" }])).toContain('"old"');
  });
});

describe("checkOps", () => {
  const body = "A one.\n\nB two.\n\nB two.";

  test("a block that no op names is at risk, and equal blocks need one op each", () => {
    const ops: Op[] = [
      { tag: "elaborated", old: "A one.", new: "A one." },
      { tag: "elaborated", old: "B two.", new: "B two." },
    ];
    expect(checkOps(body, ops)).toEqual({ ok: false, atRisk: ["B two."] });
    expect(checkOps(body, [])).toEqual({
      ok: false,
      atRisk: ["A one.", "B two.", "B two."],
    });
  });

  test("a kept, a removed and a new block all cover and build the body", () => {
    const ops: Op[] = [
      { tag: "elaborated", old: "A one.", new: "A one, longer." },
      { tag: "removed", old: "B two." },
      { tag: "elaborated", old: "B two.", new: "B two." },
      { tag: "new", new: "C three." },
    ];
    const checked = checkOps(body, ops);
    expect(checked.ok).toBe(true);
    if (checked.ok) {
      expect(applyOps(checked.ops)).toBe(
        "A one, longer.\n\nB two.\n\nC three.",
      );
    }
  });

  test("an old that quotes no block is a removal that is not real, plus a new block", () => {
    const checked = checkOps("A one.", [
      { tag: "elaborated", old: "A one.", new: "A one." },
      { tag: "elaborated", old: "made up", new: "X" },
      { tag: "removed", old: "also made up" },
    ]);
    expect(checked).toEqual({
      ok: true,
      ops: [
        { tag: "elaborated", old: "A one.", new: "A one." },
        { tag: "removed", old: "made up", real: false },
        { tag: "new", new: "X" },
        { tag: "removed", old: "also made up", real: false },
      ],
    });
  });
});

describe("wordDiff", () => {
  test("marks removed and added words and leaves shared words plain", () => {
    expect(
      wordDiff("Invoices go out on the 1st.", "Invoices go out on the 5th."),
    ).toBe("Invoices go out on the [-1st.-] {+5th.+}");
    expect(wordDiff("a b c", "a c d")).toBe("a [-b-] c {+d+}");
    expect(wordDiff("", "new words")).toBe("{+new words+}");
    expect(wordDiff("old words", "")).toBe("[-old words-]");
    expect(wordDiff("same", "same")).toBe("same");
  });
});

describe("rendering", () => {
  const ops = checkOps("A one.\n\nB two.\n\nC three.", [
    { tag: "elaborated", old: "A one.", new: "A one." },
    { tag: "elaborated", old: "B two.", new: "B 2." },
    { tag: "removed", old: "C three." },
    { tag: "removed", old: "ghost" },
    { tag: "new", new: "D four." },
  ]);

  test("a body prints block by block in the order of the ops", () => {
    if (!ops.ok) throw new Error("cover failed");
    expect(bodyDiff(ops.ops)).toEqual([
      "A one.",
      "B [-two.-] {+2.+}",
      "[-C three.-]",
      "[-ghost-] (not a block of the body)",
      "{+D four.+}",
    ]);
  });

  test("the pending section shows the title, the why and the body, each only when it changes", () => {
    if (!ops.ok) throw new Error("cover failed");
    const lines = renderPending(
      { title: "We charge per seat", why: "w" },
      { title: "We charge per active seat", why: "w2", ops: ops.ops },
    );
    expect(lines[0]).toBe("pending change:");
    expect(lines).toContain("  title: We charge per {+active+} seat");
    expect(lines).toContain("  why: [-w-] {+w2+}");
    expect(lines).toContain("  body:");
    expect(lines).toContain("    A one.");
    expect(renderPending({ title: "t", why: "w" }, { why: "x" })).toEqual([
      "pending change:",
      "  why: [-w-] {+x+}",
    ]);
  });
});
