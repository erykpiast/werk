import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { emptyChat, reduce } from "../lib/chat-log";
import { ChatLog } from "./chat-log";

let root: Root | undefined;
let host: HTMLElement | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
});

test("a sent message shows each image under its own [Image #N] token", async () => {
  const state = reduce(emptyChat, {
    type: "sent",
    turn: "t1",
    text: "[Image #1] Why is this red?",
    images: ["a.png"],
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(<ChatLog state={state} imageUrl={(n) => `/img?name=${n}`} />),
  );
  const img = host.querySelector('[data-role="user"] img');
  expect(img?.getAttribute("src")).toBe("/img?name=a.png");
  expect(img?.getAttribute("alt")).toBe("[Image #1]");
  expect(host.querySelector('[data-role="user"]')?.textContent).toContain(
    "Why is this red?",
  );
});
