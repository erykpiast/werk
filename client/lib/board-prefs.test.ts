import { expect, test } from "bun:test";
import { readPrefs, sidebarMode, writePrefs } from "./board-prefs";

const store = (initial: Record<string, string> = {}) => {
  const data = { ...initial };
  return {
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
};

test("a project with no stored choice has the defaults", () => {
  expect(readPrefs(store(), "p")).toEqual({
    sidebarFolded: false,
    logExpanded: false,
  });
});

test("a choice is kept for its project only", () => {
  const s = store();
  writePrefs(s, "p", { sidebarFolded: true, logExpanded: true });
  expect(readPrefs(s, "p")).toEqual({ sidebarFolded: true, logExpanded: true });
  expect(readPrefs(s, "q").sidebarFolded).toBe(false);
});

test("a damaged value gives the defaults", () => {
  for (const bad of ["{", "null", "3"]) {
    expect(readPrefs(store({ "werk.board.p": bad }), "p")).toEqual({
      sidebarFolded: false,
      logExpanded: false,
    });
  }
});

test("an expanded log hides the sidebar, and a fold makes it a rail", () => {
  expect(sidebarMode({ sidebarFolded: false, logExpanded: false })).toBe(
    "full",
  );
  expect(sidebarMode({ sidebarFolded: true, logExpanded: false })).toBe("rail");
  expect(sidebarMode({ sidebarFolded: true, logExpanded: true })).toBe(
    "hidden",
  );
});
