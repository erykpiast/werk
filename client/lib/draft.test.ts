import { expect, test } from "bun:test";
import { restoreDraft, stashDraft } from "./draft";

function storage() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

test("a stashed draft comes back once", () => {
  const s = storage();
  stashDraft(s, "half a thought");
  expect(restoreDraft(s)).toBe("half a thought");
  expect(restoreDraft(s)).toBe("");
});

test("an empty draft stashes nothing and clears an older one", () => {
  const s = storage();
  stashDraft(s, "old");
  stashDraft(s, "");
  expect(s.items.size).toBe(0);
  expect(restoreDraft(s)).toBe("");
});
