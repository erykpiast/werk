import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { BoardView, TicketView } from "../../src/board/view";
import type { BoardPrefs } from "../lib/board-prefs";
import { Board } from "./board";

let root: Root | undefined;
let host: HTMLElement | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
});

const ticket = (id: string, extra: Partial<TicketView> = {}): TicketView => ({
  id,
  title: `Title ${id}`,
  column: "ready",
  retries: 0,
  openBlockers: 0,
  running: false,
  text: "## What to build\n\nDo it.",
  cites: [],
  blockers: [],
  checks: [],
  stories: [],
  touches: [],
  decisions: null,
  ...extra,
});

const boardOf = (...tickets: TicketView[]): BoardView => {
  const columns: BoardView["columns"] = {
    blocked: [],
    ready: [],
    building: [],
    merging: [],
    done: [],
  };
  for (const t of tickets) columns[t.column].push(t);
  return { columns };
};

const PREFS: BoardPrefs = { sidebarFolded: false, logExpanded: false };

async function render(
  board: BoardView | null,
  extra: {
    selected?: string | null;
    prefs?: BoardPrefs;
    lines?: { time: string; text: string }[] | null;
    onSelect?: (id: string | null) => void;
    onPrefs?: (p: BoardPrefs) => void;
  } = {},
) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(
      <Board
        board={board}
        lines={extra.lines ?? null}
        selected={extra.selected ?? null}
        prefs={extra.prefs ?? PREFS}
        onSelect={extra.onSelect ?? (() => {})}
        onPrefs={extra.onPrefs ?? (() => {})}
      />,
    ),
  );
  return host;
}

const q = (el: HTMLElement, selector: string) =>
  el.querySelector<HTMLElement>(selector);

test("a board that is still loading says so", async () => {
  expect((await render(null)).textContent).toContain("Reading the board");
});

test("the five columns hold their tickets, and a card shows the counts only when they apply", async () => {
  const el = await render(
    boardOf(
      ticket("r/01"),
      ticket("r/02", {
        column: "building",
        running: true,
        retries: 3,
        openBlockers: 2,
      }),
      ticket("r/03", { column: "done", retries: 1 }),
    ),
  );
  expect(
    [...el.querySelectorAll("[data-slot=column]")].map((c) =>
      c.getAttribute("data-column"),
    ),
  ).toEqual(["blocked", "ready", "building", "merging", "done"]);
  const building = q(el, "[data-column=building]") as HTMLElement;
  expect(building.querySelectorAll("[data-slot=ticket-card]")).toHaveLength(1);
  expect(q(building, "[data-slot=retries]")?.textContent).toBe("↻3");
  expect(q(building, "[data-slot=blockers]")?.textContent).toBe("⊘2");
  expect(q(building, "[data-slot=live-dot]")?.hasAttribute("data-corner")).toBe(
    true,
  );
  const done = q(el, "[data-column=done]") as HTMLElement;
  expect(q(done, "[data-slot=retries]")).toBeNull();
  expect(q(done, "[data-slot=live-dot]")).toBeNull();
});

test("a card carries its full title for the hover", async () => {
  const long =
    "Import ticket files from the plan folder and skip ids that already exist on a second run";
  const el = await render(boardOf(ticket("r/01", { title: long })));
  expect(q(el, "[data-slot=ticket-title]")?.getAttribute("title")).toBe(long);
});

test("a click on a card selects it, and a click on the open card closes the drawer", async () => {
  const picked: (string | null)[] = [];
  const el = await render(boardOf(ticket("r/01")), {
    onSelect: (id) => picked.push(id),
  });
  await act(async () => q(el, "[data-slot=ticket-card]")?.click());
  expect(picked).toEqual(["r/01"]);
  await act(async () => root?.unmount());
  host?.remove();
  const open = await render(boardOf(ticket("r/01")), {
    selected: "r/01",
    onSelect: (id) => picked.push(id),
  });
  await act(async () => q(open, "[data-slot=ticket-card]")?.click());
  expect(picked).toEqual(["r/01", null]);
});

test("the drawer shows the full title, the text and the sidebar facts", async () => {
  const el = await render(
    boardOf(
      ticket("r/01", {
        title: "A very long title that the card would cut",
        cites: ["card-a"],
        blockers: [{ id: "r/00", done: true }],
        retries: 1,
        checks: ["make test"],
        stories: ["4"],
        touches: ["board view"],
      }),
    ),
    { selected: "r/01" },
  );
  const drawer = q(el, "[data-slot=drawer]") as HTMLElement;
  expect(q(drawer, "[data-slot=drawer-title]")?.textContent).toBe(
    "A very long title that the card would cut",
  );
  expect(q(drawer, "[data-slot=ticket-text]")?.textContent).toContain("Do it.");
  const cite = q(drawer, "[aria-label=Cites] a");
  expect(cite?.getAttribute("href")).toBe("/map/card-a");
  expect(q(drawer, "[aria-label=Blockers]")?.textContent).toContain(
    "r/00 (done)",
  );
  expect(q(drawer, "[aria-label=Checks]")?.textContent).toContain("make test");
  expect(q(drawer, "[aria-label=Stories]")?.textContent).toContain("4");
  expect(q(drawer, "[aria-label=Touches]")?.textContent).toContain(
    "board view",
  );
  expect(q(drawer, "[aria-label=Decisions]")).toBeNull();
  expect(q(drawer, "[data-slot=live-log]")).toBeNull();
});

test("a building ticket's drawer shows the live log above the text, with its running dot", async () => {
  const el = await render(
    boardOf(ticket("r/01", { column: "building", running: true })),
    {
      selected: "r/01",
      lines: [
        { time: "2026-10-25 10:00:00", text: "system init" },
        { time: "2026-10-25 10:00:05", text: "agent: hello" },
      ],
    },
  );
  const log = q(el, "[data-slot=live-log]") as HTMLElement;
  expect(log.querySelectorAll("[data-slot=log-line]")).toHaveLength(2);
  expect(q(log, "time")?.textContent).toBe("2026-10-25 10:00:00");
  const main = q(el, "[data-slot=drawer-main]") as HTMLElement;
  expect(main.firstElementChild).toBe(log);
  expect(q(el, "[data-slot=drawer-bar] [data-slot=live-dot]")).not.toBeNull();
});

test("the decisions section lists the cards with their state, or says no new card", async () => {
  const withCards = await render(
    boardOf(
      ticket("r/01", {
        decisions: {
          cards: [
            { id: "c", title: "C", state: "proposal" },
            { id: "d", title: "D", state: "accepted" },
            { id: "e", title: "", state: "gone" },
          ],
          followed: [],
        },
      }),
    ),
    { selected: "r/01" },
  );
  const items = [
    ...(q(withCards, "[aria-label=Decisions]") as HTMLElement).querySelectorAll(
      "li",
    ),
  ];
  expect(items.map((li) => li.textContent)).toEqual([
    "#c proposal",
    "#d accepted",
    "#e gone",
  ]);
  expect(items[0]?.querySelector("a")?.getAttribute("href")).toBe("/map/c");
  expect(items[2]?.querySelector("a")).toBeNull();
  await act(async () => root?.unmount());
  host?.remove();
  const none = await render(
    boardOf(ticket("r/01", { decisions: { cards: [], followed: ["a", "b"] } })),
    { selected: "r/01" },
  );
  expect(q(none, "[aria-label=Decisions]")?.textContent).toContain(
    "No new card. Followed #a, #b.",
  );
  await act(async () => root?.unmount());
  host?.remove();
  const bare = await render(
    boardOf(ticket("r/01", { decisions: { cards: [], followed: [] } })),
    { selected: "r/01" },
  );
  expect(q(bare, "[aria-label=Decisions]")?.textContent).toContain(
    "No new card.",
  );
  expect(q(bare, "[aria-label=Decisions]")?.textContent).not.toContain(
    "Followed",
  );
});

test("the toggles report the new choice, a folded sidebar is a rail, and an expanded log hides the sidebar", async () => {
  const seen: BoardPrefs[] = [];
  const building = boardOf(ticket("r/01", { column: "building" }));
  const el = await render(building, {
    selected: "r/01",
    onPrefs: (p) => seen.push(p),
  });
  await act(async () => q(el, "[data-slot=side-toggle]")?.click());
  await act(async () => q(el, "[data-slot=log-toggle]")?.click());
  expect(seen).toEqual([
    { sidebarFolded: true, logExpanded: false },
    { sidebarFolded: false, logExpanded: true },
  ]);
  await act(async () => root?.unmount());
  host?.remove();
  const rail = await render(building, {
    selected: "r/01",
    prefs: { sidebarFolded: true, logExpanded: false },
  });
  expect(q(rail, "[data-slot=drawer-side]")?.getAttribute("data-mode")).toBe(
    "rail",
  );
  expect(q(rail, "[aria-label=Retries]")).toBeNull();
  await act(async () => root?.unmount());
  host?.remove();
  const hidden = await render(building, {
    selected: "r/01",
    prefs: { sidebarFolded: false, logExpanded: true },
  });
  expect(q(hidden, "[data-slot=drawer-side]")).toBeNull();
  expect(q(hidden, "[data-slot=live-log]")?.hasAttribute("data-expanded")).toBe(
    true,
  );
});

test("Close drops the drawer", async () => {
  const picked: (string | null)[] = [];
  const el = await render(boardOf(ticket("r/01")), {
    selected: "r/01",
    onSelect: (id) => picked.push(id),
  });
  await act(async () => q(el, "[data-slot=drawer-close]")?.click());
  expect(picked).toEqual([null]);
});
