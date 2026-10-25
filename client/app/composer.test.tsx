import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Composer } from "./composer";

let root: Root | undefined;
let host: HTMLElement | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  sessionStorage.clear();
});

async function render(node: React.ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(node));
  return host;
}

test("the composer restores a stashed draft once", async () => {
  sessionStorage.setItem("werk.composer.draft", "kept");
  const el = await render(<Composer />);
  expect(el.querySelector("textarea")?.value).toBe("kept");
  expect(sessionStorage.getItem("werk.composer.draft")).toBeNull();
});
