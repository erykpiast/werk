import { expect, test } from "bun:test";
import { createTabsStore } from "./tabs-store";

const store = (tabs: string[] = ["main"]) =>
  createTabsStore(
    {
      fetch: async () => Response.json({ tabs, events: [] }),
      token: "t",
      card: () => null,
      now: () => 0,
      newTurn: () => "t1",
    },
    "p",
  );

test("an event that names a tab reaches that tab while another tab is shown", () => {
  const tabs = store();
  tabs.receive("dead", JSON.stringify({ tab: "A", error: "boom" }));
  const state = tabs.get();
  expect(state.order).toEqual(["main", "A"]);
  expect(state.current).toBe("main");
  expect(state.chats.A?.dead).toBe("boom");
  expect(state.chats.main?.dead).toBeNull();
  tabs.receive("dead", JSON.stringify({ tab: "A", error: null }));
  expect(tabs.get().chats.A?.dead).toBeNull();
});

test("an event with no tab belongs to the main conversation", () => {
  const tabs = store();
  tabs.receive("dead", JSON.stringify({ error: "main failed" }));
  expect(tabs.get().chats.main?.dead).toBe("main failed");
});

test("a load opens the tabs that the server holds, and a new tab is shown at once", async () => {
  const tabs = store(["main", "A"]);
  await tabs.load();
  expect(tabs.get().order).toEqual(["main", "A"]);
  tabs.select("A");
  expect(tabs.get().current).toBe("A");
  tabs.select("none");
  expect(tabs.get().current).toBe("A");
  tabs.open();
  expect(tabs.get().order).toEqual(["main", "A", "3"]);
  expect(tabs.get().current).toBe("3");
});
