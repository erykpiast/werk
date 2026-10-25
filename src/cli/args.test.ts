import { describe, expect, test } from "bun:test";
import { cardId, parseArgs } from "./args.ts";

const spec = { flags: ["title", "parent"], idFlags: ["parent"] };

describe("cardId", () => {
  test("removes one leading hash sign and nothing else", () => {
    expect(cardId("#auth")).toBe("auth");
    expect(cardId("auth")).toBe("auth");
    expect(cardId("##auth")).toBe("#auth");
    expect(cardId("a#b")).toBe("a#b");
  });
});

describe("parseArgs", () => {
  test("splits positional arguments and flags, in both flag forms", () => {
    expect(parseArgs(["x", "--title", "T", "--parent=y"], spec)).toEqual({
      ok: true,
      positional: ["x"],
      flags: { title: "T", parent: "y" },
    });
  });

  test("an id flag loses its hash sign, a text flag keeps it", () => {
    const parsed = parseArgs(["--parent", "#p", "--title", "#T"], spec);
    expect(parsed).toMatchObject({
      ok: true,
      flags: { parent: "p", title: "#T" },
    });
  });

  test("refuses an unknown flag, a repeated flag and a flag with no value", () => {
    expect(parseArgs(["--nope", "1"], spec)).toEqual({
      ok: false,
      error: "unknown flag --nope",
    });
    expect(parseArgs(["--title", "a", "--title", "b"], spec)).toEqual({
      ok: false,
      error: "flag --title is given twice",
    });
    expect(parseArgs(["--title"], spec)).toEqual({
      ok: false,
      error: "flag --title needs a value",
    });
  });
});
