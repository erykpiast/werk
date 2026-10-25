import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { type ChatState, emptyChat, reduce } from "../lib/chat-log";
import type { ChatStore } from "../lib/chat-store";
import { NextOffer, StatusLines } from "./chat-notes";

let root: Root | undefined;
let host: HTMLElement | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
});

async function render(node: React.ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(node));
  return host;
}

const replied = (text: string): ChatState => {
  const sent = reduce(emptyChat, { type: "sent", turn: "t1", text: "hi" });
  const said = reduce(sent, {
    type: "chat",
    turn: "t1",
    id: "b1",
    block: { kind: "text", text },
  });
  return reduce(said, {
    type: "turn-end",
    turn: "t1",
    durationMs: 1,
    costUsd: null,
    error: false,
  });
};

test("the offer is a button with the phrase, and a click sends the phrase", async () => {
  const sent: string[] = [];
  const store = { send: async (text: string) => void sent.push(text) };
  const el = await render(
    <NextOffer
      state={replied('Done.\nNext: say "merge it"')}
      store={store as unknown as ChatStore}
    />,
  );
  const button = el.querySelector("button");
  expect(button?.textContent).toBe("merge it");
  await act(async () => button?.click());
  expect(sent).toEqual(["merge it"]);
});

test("a reply with no Next line shows no button", async () => {
  const el = await render(
    <NextOffer state={replied("Done.")} store={{} as ChatStore} />,
  );
  expect(el.querySelector("button")).toBeNull();
});

test("the background line shows while tasks run", async () => {
  const none = await render(<StatusLines state={emptyChat} />);
  expect(none.textContent).toBe("");
  await act(async () =>
    root?.render(<StatusLines state={{ ...emptyChat, background: 2 }} />),
  );
  expect(host?.textContent).toContain("A background agent runs");
});
