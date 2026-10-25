import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { type ChatState, emptyChat, reduce } from "../lib/chat-log";
import { ChatHead } from "./chat-head";

let root: Root | undefined;
let host: HTMLElement | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
});

const settings = {
  model: "opus" as const,
  advisor: null,
  used: 150_000,
  window: 200_000,
};

function fakeStore() {
  const calls: unknown[][] = [];
  return {
    calls,
    store: {
      setModel: async (...args: unknown[]) => {
        calls.push(["model", ...args]);
        return null;
      },
      clearContext: async () => {
        calls.push(["clear"]);
        return null;
      },
    },
  };
}

async function render(
  state: ChatState,
  store: ReturnType<typeof fakeStore>["store"],
) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<ChatHead state={state} store={store} />));
  return host;
}

test("the saved model and fill show before any message", async () => {
  const { store } = fakeStore();
  const el = await render(
    reduce(emptyChat, { type: "model", settings }),
    store,
  );
  expect(el.querySelector<HTMLSelectElement>("select")?.value).toBe("opus");
  const pie = el.querySelector("[data-slot=context-pie]");
  expect(pie?.getAttribute("data-level")).toBe("red");
  expect(pie?.getAttribute("aria-label")).toBe("Context 75% full");
});

test("choosing a model sends the pick, and the popover offers Clear context", async () => {
  const { store, calls } = fakeStore();
  const el = await render(
    reduce(emptyChat, { type: "model", settings }),
    store,
  );
  const select = el.querySelector("select") as HTMLSelectElement;
  await act(async () => {
    select.value = "sonnet+opus";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(calls).toEqual([["model", "sonnet", "opus"]]);
  await act(async () =>
    el.querySelector<HTMLButtonElement>("[data-slot=context-pie]")?.click(),
  );
  expect(el.textContent).toContain("75% of the context window is in use");
  const clear = [...el.querySelectorAll("button")].find(
    (b) => b.textContent === "Clear context",
  );
  await act(async () => clear?.click());
  expect(calls.at(-1)).toEqual(["clear"]);
});

test("the controls are disabled while a turn runs", async () => {
  const { store } = fakeStore();
  const busy = [
    { type: "model", settings } as const,
    { type: "sent", turn: "a", text: "hi" } as const,
    { type: "turn-start", turn: "a", at: Date.now() } as const,
  ].reduce(reduce, emptyChat);
  const el = await render(busy, store);
  expect(el.querySelector("select")?.disabled).toBe(true);
  await act(async () =>
    el.querySelector<HTMLButtonElement>("[data-slot=context-pie]")?.click(),
  );
  const clear = [...el.querySelectorAll("button")].find(
    (b) => b.textContent === "Clear context",
  );
  expect(clear?.disabled).toBe(true);
});
