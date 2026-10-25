import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { MapState } from "../lib/map-store";
import { Composer } from "./composer";
import { LeftPane } from "./left-pane";

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

const view = (id: string, title: string, proposed = false) => ({
  id,
  title,
  why: "",
  body: "",
  status: "open",
  proposed,
});

test("the left pane shows the scope, the open title and its sub-cards", async () => {
  const map: MapState = {
    connection: "live",
    loaded: true,
    open: { ...view("root", "Root title"), why: "Because.", body: "More." },
    subCards: [view("a", "Child A", true)],
  };
  const el = await render(<LeftPane map={map} />);
  expect(el.querySelector("[data-slot=header-row-1]")?.textContent).toBe(
    "#root",
  );
  expect(el.querySelector("[data-slot=header-right]")?.textContent).toBe(
    "live",
  );
  expect(el.querySelector("h1")?.textContent).toBe("Root title");
  expect(el.textContent).toContain("Because.");
  expect(el.textContent).toContain("More.");
  expect(el.querySelector("[data-card-id=a]")?.textContent).toContain(
    "proposed",
  );
});

test("the left pane says so while loading and when the map is empty", async () => {
  const base = {
    connection: "connecting",
    open: null,
    subCards: [],
  } satisfies Omit<MapState, "loaded">;
  let el = await render(<LeftPane map={{ ...base, loaded: false }} />);
  expect(el.textContent).toContain("Loading the map");
  await act(async () => root?.unmount());
  host?.remove();
  el = await render(<LeftPane map={{ ...base, loaded: true }} />);
  expect(el.textContent).toContain("no cards yet");
});

test("the composer restores a stashed draft once", async () => {
  sessionStorage.setItem("werk.composer.draft", "kept");
  const el = await render(<Composer />);
  expect(el.querySelector("textarea")?.value).toBe("kept");
  expect(sessionStorage.getItem("werk.composer.draft")).toBeNull();
});
