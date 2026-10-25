import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { type ChatState, emptyChat, type PendingAsk } from "../lib/chat-log";
import type { AskAnswer, ChatStore } from "../lib/chat-store";
import { AskBar } from "./ask-bar";

let root: Root | undefined;
let host: HTMLElement | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
});

const ask = (extra: Partial<PendingAsk> = {}): PendingAsk => ({
  id: "a1",
  turn: "t",
  tool: "Bash",
  input: { command: "mkdir -p /tmp/x" },
  reason: "rule",
  suggestion: null,
  questions: null,
  sending: false,
  ...extra,
});

function fakeStore() {
  const answers: [string, AskAnswer][] = [];
  const store = {
    answer: async (id: string, answer: AskAnswer) => {
      answers.push([id, answer]);
    },
    pick: () => {},
  } as unknown as ChatStore;
  return { store, answers };
}

async function render(state: Partial<ChatState>, store: ChatStore) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(<AskBar state={{ ...emptyChat, ...state }} store={store} />),
  );
  return host;
}

const buttons = (el: HTMLElement) =>
  [...el.querySelectorAll("button")].map((b) => b.textContent);

test("the bar names the tool, shows the call and the reason as sent, and offers two buttons", async () => {
  const el = await render({ asks: [ask()] }, fakeStore().store);
  expect(el.textContent).toContain("Bash wants to run. The turn is waiting.");
  expect(el.querySelector("pre")?.textContent).toBe("mkdir -p /tmp/x");
  expect(el.textContent).toContain("Claude Code could not decide: rule");
  expect(buttons(el)).toEqual(["Allow once", "Deny"]);
});

test("Always allow shows only with a suggestion, and the rule shows inline", async () => {
  const el = await render(
    { asks: [ask({ suggestion: "Bash(mkdir:*)" })] },
    fakeStore().store,
  );
  expect(buttons(el)).toEqual([
    "Allow once",
    "Always allow Bash(mkdir:*)",
    "Deny",
  ]);
});

test("a click answers, and an ask whose answer is on the way has every button disabled", async () => {
  const { store, answers } = fakeStore();
  const el = await render({ asks: [ask({ suggestion: "r" })] }, store);
  await act(async () => el.querySelectorAll("button")[1]?.click());
  expect(answers).toEqual([["a1", { decision: "always" }]]);
  await act(async () =>
    root?.render(
      <AskBar
        state={{ ...emptyChat, asks: [ask({ sending: true })] }}
        store={store}
      />,
    ),
  );
  expect([...el.querySelectorAll("button")].every((b) => b.disabled)).toBe(
    true,
  );
});

test("Cmd+Enter allows and Escape denies the first ask only, before any other handler sees the key", async () => {
  const { store, answers } = fakeStore();
  await render({ asks: [ask(), ask({ id: "a2" })] }, store);
  let reached = false;
  const spy = () => {
    reached = true;
  };
  document.addEventListener("keydown", spy);
  await act(async () => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", metaKey: true }),
    );
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
  });
  document.removeEventListener("keydown", spy);
  expect(answers).toEqual([
    ["a1", { decision: "allow" }],
    ["a1", { decision: "deny" }],
  ]);
  expect(reached).toBe(false);
});

test("a question form shows lettered options, takes free text, and submits the picks", async () => {
  const { store, answers } = fakeStore();
  const questions = [
    {
      question: "Which db?",
      header: "DB",
      multiSelect: false,
      options: [
        { label: "Postgres", description: "SQL" },
        { label: "SQLite", description: "file" },
      ],
    },
  ];
  const open = ask({ id: "q1", tool: "AskUserQuestion", questions });
  const el = await render({ asks: [open] }, store);
  expect(el.textContent).toContain("A. Postgres");
  expect(el.textContent).toContain("B. SQLite");
  expect(buttons(el)).toEqual(["Submit answer", "Decline"]);
  expect(el.querySelectorAll("button")[0]?.disabled).toBe(true);
  await act(async () =>
    root?.render(
      <AskBar
        state={{
          ...emptyChat,
          asks: [open],
          selections: { q1: [{ labels: ["SQLite"], other: "" }] },
        }}
        store={store}
      />,
    ),
  );
  await act(async () => el.querySelectorAll("button")[0]?.click());
  expect(answers).toEqual([
    ["q1", { decision: "answer", picks: [["SQLite"]] }],
  ]);
});

test("no ask draws no bar", async () => {
  const el = await render({}, fakeStore().store);
  expect(el.querySelector('[data-slot="ask-bar"]')).toBeNull();
});
