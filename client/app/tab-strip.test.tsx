import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DeadLines, OwnError, TabStrip } from "./tab-strip";

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

test("a dead tab's chip blinks red and a click selects its tab", async () => {
  const picked: string[] = [];
  const el = await render(
    <TabStrip
      chips={[
        { tab: "A", current: false, blink: "red" },
        { tab: "B", current: true, blink: null },
      ]}
      onSelect={(t) => picked.push(t)}
      onOpen={() => picked.push("new")}
    />,
  );
  const chips = el.querySelectorAll("[data-slot=tab-chip]");
  expect(chips[0]?.getAttribute("data-blink")).toBe("red");
  expect(chips[1]?.getAttribute("data-blink")).toBeNull();
  await act(async () => (chips[0] as HTMLElement).click());
  expect(picked).toEqual(["A"]);
  await act(async () =>
    (el.querySelector("[data-slot=tab-new]") as HTMLElement).click(),
  );
  expect(picked).toEqual(["A", "new"]);
});

test("the pane shows one line for a dead tab, and the whole error in its own pane", async () => {
  const el = await render(
    <>
      <DeadLines lines={[{ tab: "A", line: "exit 1" }]} />
      <OwnError error={"exit 1\nmore"} />
    </>,
  );
  expect(el.querySelector("[data-slot=dead-line]")?.textContent).toBe(
    "A stopped: exit 1",
  );
  expect(el.querySelector("[data-slot=dead-error]")?.textContent).toBe(
    "exit 1\nmore",
  );
  await act(async () => root?.render(<OwnError error={null} />));
  expect(host?.textContent).toBe("");
});
