import { expect, test } from "bun:test";
import { emptyChat } from "./chat-log";
import {
  chipsOf,
  deadLinesOf,
  nextTabName,
  ownErrorOf,
  type TabsState,
} from "./chat-tabs";

const ERROR = "the agent exited with code 1\nboom: line two";

const stateOf = (current: string, dead: Record<string, string>): TabsState => ({
  order: ["A", "B"],
  chats: {
    A: { ...emptyChat, dead: dead.A ?? null },
    B: { ...emptyChat, dead: dead.B ?? null },
  },
  current,
});

test("a crashed agent marks its tab and tells the other tabs, until its next agent starts", () => {
  // Tab B is shown while the agent of tab A exits with an error.
  const crashed = stateOf("B", { A: ERROR });
  expect(chipsOf(crashed)).toEqual([
    { tab: "A", current: false, blink: "red" },
    { tab: "B", current: true, blink: null },
  ]);
  expect(deadLinesOf(crashed)).toEqual([
    { tab: "A", line: "the agent exited with code 1" },
  ]);
  expect(ownErrorOf(crashed)).toBeNull();

  // The person switches to tab A: its pane shows the whole error, and no line names it.
  const shown = stateOf("A", { A: ERROR });
  expect(ownErrorOf(shown)).toBe(ERROR);
  expect(deadLinesOf(shown)).toEqual([]);
  expect(chipsOf(shown)[0]?.blink).toBe("red");

  // A new agent starts for tab A: the blink and the line are gone.
  const restarted = stateOf("A", {});
  expect(chipsOf(restarted).every((c) => c.blink === null)).toBe(true);
  expect(deadLinesOf(stateOf("B", {}))).toEqual([]);
});

test("a new tab gets a name that no open tab has", () => {
  expect(nextTabName(["main"])).toBe("2");
  expect(nextTabName(["main", "2"])).toBe("3");
  expect(nextTabName(["main", "3"])).toBe("4");
});
