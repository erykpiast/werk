import { appendFileSync } from "node:fs";
import { join } from "node:path";
import {
  decided,
  link,
  open,
  reopen,
} from "../../src/map/mark-fixtures.ts";
import { type BrowserServer, expect, jsonl, leftPane, test } from "./support.ts";

/** Decides the root card of the fixture, so that its children can pass the basis fact. */
const decideRoot = () => [
  { type: "node.edited", id: "root", who: "me", noBasis: "test" },
  { type: "criterion.added", id: "root", form: "revisit" },
  { type: "node.decided", id: "root" },
];

const writeLog = (s: BrowserServer, ...events: unknown[]) =>
  appendFileSync(join(s.dir, ".werk", "log.jsonl"), jsonl(...events.flat()));

test("17.2 the header counts follow the open card", async ({ page, make }) => {
  // root (open) has: o1 open, p1 proto (with child g open), d1 decided, base decided->reopened (open),
  // sdec decided and stale because it depends on base.
  const s = await make({
    seed: (s) =>
      writeLog(
        s,
        decideRoot(),
        open("o1", { parent: "root" }),
        open("p1", { parent: "root", status: "proto" }),
        open("g", { parent: "p1" }),
        decided("d1", { parent: "root" }),
        decided("base", { parent: "root" }),
        decided("sdec", { parent: "root" }),
        link("sdec", "base"),
        reopen("base"),
      ),
  });
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(`${s.url}/map/root`);
  await expect(leftPane(page).getByRole("heading", { level: 1 })).toBeVisible();
  const counts = page.locator("[data-slot=counts] [data-slot=count]");
  const read = () =>
    page.evaluate(() => {
      const out: Record<string, { n: number; title: string }> = {};
      for (const el of document.querySelectorAll(
        "[data-slot=counts] [data-slot=count]",
      )) {
        out[el.getAttribute("data-kind") as string] = {
          n: Number(el.textContent),
          title: el.getAttribute("title") ?? "",
        };
      }
      return out;
    });
  await expect(counts.first()).toBeVisible();
  let c = await read();
  // root(decided) + o1 + p1 + g + d1 + base(reopened) + sdec(decided, stale) = 7 cards: open 3, proto 1, decided 3
  expect(c.total?.n).toBe(7);
  expect(c.open?.n).toBe(3);
  expect(c.proto?.n).toBe(1);
  expect(c.decided?.n).toBe(3);
  expect(c.open.n + c.proto.n + c.decided.n).toBe(c.total.n);
  expect(c.stale?.n).toBe(1);
  expect(c.postponed).toBeUndefined();
  for (const k of Object.keys(c)) expect(c[k]?.n).toBeGreaterThan(0);
  expect(c.open.title).toContain("open");
  expect(c.proto.title).toContain("proto");
  expect(c.decided.title).toContain("decided");
  expect(c.stale.title).toContain("stale");

  // a child with a smaller subtree
  await leftPane(page).locator("a.tile", { hasText: "Title p1" }).click();
  await expect(page).toHaveURL(/\/map\/p1$/);
  await expect
    .poll(async () => (await read()).total?.n)
    .toBe(2);
  c = await read();
  expect(c.open.n).toBe(1);
  expect(c.proto.n).toBe(1);
  expect(c.decided).toBeUndefined();
});

test("17.3 a person finds a card by id and opens it from the search box", async ({
  page,
  make,
}) => {
  const events: unknown[] = [decideRoot()];
  events.push(decided("werk", { parent: "root" }));
  events.push(decided("base", { parent: "root" }));
  const starts = "abcdefghij".split("").map((l) => `werk-${l}`);
  for (const id of starts) events.push(decided(id, { parent: "root" }));
  for (const l of "abcd") events.push(decided(`${l}-werk`, { parent: "root" }));
  // werk-b is stale
  events.push(link("werk-b", "base"));
  events.push(reopen("base"));
  const s = await make({ seed: (s) => writeLog(s, ...events) });
  await page.goto(s.url);
  await expect(leftPane(page).getByRole("heading", { level: 1 })).toBeVisible();
  const box = page.getByRole("searchbox", { name: "Search the map" });
  await box.fill("#werk");
  const list = page.getByRole("list", { name: "Search results" });
  const rows = list.getByRole("listitem");
  await expect(rows).toHaveCount(12);
  const ids = await rows.locator("code").allInnerTexts();
  expect(ids[0]).toBe("werk");
  const firstContains = ids.findIndex((id) => !id.startsWith("werk"));
  expect(firstContains).toBeGreaterThan(0);
  for (const id of ids.slice(0, firstContains)) expect(id.startsWith("werk")).toBe(true);
  for (const id of ids.slice(firstContains)) expect(id).toContain("werk");
  // each row: dot, title, id
  for (const row of await rows.all()) {
    await expect(row.locator("[data-slot=dot]")).toHaveCount(1);
    await expect(row.locator("[data-slot=result-title]")).not.toBeEmpty();
    await expect(row.locator("code")).not.toBeEmpty();
  }
  const stale = rows.filter({ has: page.locator("code", { hasText: /^werk-b$/ }) });
  const dot = stale.locator("[data-slot=dot]");
  await expect(dot).toHaveAttribute("data-color", "stale");
  const bg = await dot.evaluate((el) => getComputedStyle(el).backgroundColor);
  const [r, g, b] = (bg.match(/\d+/g) ?? []).map(Number);
  expect(r).toBeGreaterThan(200);
  expect(g).toBeLessThan(100);
  expect(b).toBeLessThan(100);

  await expect(rows.first()).toHaveAttribute("aria-current", "true");
  await box.press("ArrowDown");
  await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
  await box.press("ArrowUp");
  await expect(rows.first()).toHaveAttribute("aria-current", "true");
  await box.press("Enter");
  await expect(page).toHaveURL(/\/map\/werk$/);
  await expect(
    page.locator("[data-slot=crumb-line] strong"),
  ).toHaveText("Title werk");
  await expect(box).toHaveValue("");
});
