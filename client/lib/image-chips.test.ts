import { expect, test } from "bun:test";
import { type Chip, insertToken, removeToken, settleSend } from "./image-chips";

test("a token goes in at the caret, and the caret moves after it", () => {
  expect(insertToken("ab", 1, 1)).toEqual({ text: "a[Image #1]b", caret: 11 });
  expect(insertToken("ab", 99, 2)).toEqual({ text: "ab[Image #2]", caret: 12 });
  expect(insertToken("ab", -3, 1).text).toBe("[Image #1]ab");
});

test("removing chip 1 of two renumbers the other to 1", () => {
  expect(removeToken("see [Image #1] and [Image #2]", 1)).toBe(
    "see  and [Image #1]",
  );
  expect(removeToken("[Image #1] [Image #2] [Image #3]", 2)).toBe(
    "[Image #1]  [Image #2]",
  );
  expect(removeToken("no tokens", 1)).toBe("no tokens");
});

test("a send drops refused images and keeps the names of the others in order", () => {
  const chips: Chip[] = [
    { id: "a", state: "ready", name: "one.png" },
    { id: "b", state: "refused", reason: "too big" },
    { id: "c", state: "ready", name: "three.png" },
  ];
  expect(settleSend("[Image #1] [Image #2] [Image #3]", chips)).toEqual({
    text: "[Image #1]  [Image #2]",
    names: ["one.png", "three.png"],
  });
  expect(settleSend("hi", [])).toEqual({ text: "hi", names: [] });
});

test("two refused images are both taken out", () => {
  const chips: Chip[] = [
    { id: "a", state: "refused" },
    { id: "b", state: "refused" },
    { id: "c", state: "ready", name: "c.png" },
  ];
  expect(settleSend("[Image #1][Image #2][Image #3]", chips).text).toBe(
    "[Image #1]",
  );
});
