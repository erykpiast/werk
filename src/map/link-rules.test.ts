import { describe, expect, test } from "bun:test";
import { fold, type LogEntry } from "./fold.ts";
import { checkLink, isAtOrAbove, sameLine } from "./link-rules.ts";

const node = (id: string, extra: Record<string, unknown> = {}) => ({
  type: "node.proposed",
  id,
  kind: "card",
  title: id,
  status: "open",
  ...extra,
});
const entries = (...events: unknown[]): LogEntry[] =>
  events.map((event, i) => ({ line: i + 1, event }));
// a > a1 > a11, and b alone, o an option.
const map = fold(
  entries(
    node("a"),
    node("a1", { parent: "a" }),
    node("a11", { parent: "a1" }),
    node("b"),
    node("o", { kind: "option" }),
  ),
);
const dep = (from: string, to: string, why = "takes the grid") => ({
  from,
  to,
  type: "depends_on" as const,
  why,
});

describe("lineage", () => {
  test("a card sits at or above itself and its descendants", () => {
    expect(isAtOrAbove(map, "a", "a11")).toBe(true);
    expect(isAtOrAbove(map, "a11", "a")).toBe(false);
    expect(isAtOrAbove(map, "a", "a")).toBe(true);
    expect(sameLine(map, "a11", "a")).toBe(true);
    expect(sameLine(map, "a1", "b")).toBe(false);
  });
});

describe("checkLink", () => {
  test("a depends_on link across subtrees with a reason is allowed", () => {
    expect(checkLink(map, dep("a1", "b"))).toBeNull();
  });
  test("a depends_on link without a reason is refused", () => {
    expect(checkLink(map, dep("a1", "b", "  "))?.rule).toBe("link-why");
  });
  test("a depends_on link to a parent, a grandparent, a descendant or itself is refused", () => {
    for (const [from, to] of [
      ["a1", "a"],
      ["a11", "a"],
      ["a", "a11"],
      ["a", "a"],
    ] as const) {
      expect(checkLink(map, dep(from, to))?.rule).toBe("lineage");
    }
  });
  test("an option links by alternative_to only", () => {
    const edge = { from: "o", to: "a", why: "" };
    expect(checkLink(map, { ...edge, type: "supported_by" })?.rule).toBe(
      "option-link",
    );
    expect(checkLink(map, { ...edge, type: "alternative_to" })).toBeNull();
  });
  test("an unknown end is refused", () => {
    expect(checkLink(map, dep("zz", "a"))?.rule).toBe("unknown-card");
    expect(checkLink(map, dep("a", "zz"))?.rule).toBe("unknown-card");
  });
  test("a second parent and a cycle are refused", () => {
    const refines = (from: string, to: string) => ({
      from,
      to,
      type: "refines" as const,
      why: "",
    });
    expect(checkLink(map, refines("a1", "b"))?.rule).toBe("second-parent");
    expect(checkLink(map, refines("a", "a11"))?.rule).toBe("cycle");
  });
});
