/// <reference lib="dom" />
// Held-out: 69.1-69.3 and 70.1-70.5 (the refines tree, live adds, the open card, ghosts and their ✓).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";
import { family } from "./e-colour.ts";

test.afterEach(stop);

const heading = (p: Page) => p.getByRole("heading", { level: 1 });
const tile = (p: Page, id: string) => p.locator(`a[data-tile="${id}"]`);
const flag = (p: Page) =>
  p.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });
const same = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);
const events = (w: Werk) =>
  readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { type: string; actor: string; payload: Record<string, unknown> });
const dashed = (at: Locator) => at.evaluate((el) => getComputedStyle(el).borderTopStyle);

test("69.1 the map shows the fixture project as a refines tree", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    d.seed("node.added", { id: "kid-a", kind: "card", title: "Kid A", parent: "root" });
    d.seed("node.added", { id: "kid-b", kind: "card", title: "Kid B", parent: "root" });
    d.seed("node.added", { id: "grand", kind: "card", title: "Grandchild", parent: "kid-a" });
  });
  await p.goto(`${w.url}/map`);
  await expect(heading(p)).toHaveText("Root");
  await expect(tile(p, "kid-a")).toBeVisible();
  await expect(tile(p, "kid-b")).toBeVisible();
  await expect(tile(p, "grand")).toHaveCount(0);
  await tile(p, "kid-a").click();
  await expect(heading(p)).toHaveText("Kid A");
  await expect(tile(p, "grand")).toBeVisible();
});

test("69.2 a card added and accepted from the command line appears with no reload", async ({ page: p }) => {
  const w = await project();
  await p.goto(`${w.url}/map`);
  await expect(heading(p)).toHaveText("Root");
  await expect(p.locator("#view")).not.toContainText("Use an append-only log");
  await flag(p);
  w.werk("add", "log", "--title", "Use an append-only log", "--parent", "root");
  w.werk("accept", "log", "--actor", "you");
  await expect(tile(p, "log")).toContainText("Use an append-only log", { timeout: 5000 });
  await expect(tile(p, "log")).toHaveAttribute("data-proposed", "false");
  expect(await same(p)).toBe(true);
});

test("69.3 the open card survives a reload and has no control that edits its text", async ({ page: p }) => {
  const w = await project(undefined, (d) =>
    d.seed("node.added", { id: "kid", kind: "card", title: "Kid card", body: "Kid body", parent: "root" }),
  );
  await p.goto(`${w.url}/map`);
  await tile(p, "kid").click();
  await expect(p).toHaveURL(/\/map\/kid$/);
  await expect(heading(p)).toHaveText("Kid card");
  await expect(p.locator('[data-field="body"]')).toContainText("Kid body");
  const view = p.locator("#view");
  // The only text box is the note box of the card's thread, which adds a note and never edits the title or body.
  const boxes = view.locator('[contenteditable="true"], textarea, input[type="text"], [role="textbox"]');
  const labels = await boxes.evaluateAll((all) => all.map((el) => el.getAttribute("aria-label")));
  expect(labels.every((l) => l === "Note")).toBe(true);
  await expect(view.getByRole("button", { name: /edit|retitle|rename|title|body/i })).toHaveCount(0);
  await p.reload();
  await expect(p).toHaveURL(/\/map\/kid$/);
  await expect(heading(p)).toHaveText("Kid card");
});

function payments(d: Pick<Werk, "seed">): void {
  d.seed("node.added", { id: "payments", kind: "card", title: "Payments", parent: "root" });
}

test("70.1 a proposed card shows as a ghost under its proposed parent", async ({ page: p }) => {
  const w = await project(undefined, payments);
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  await p.goto(`${w.url}/map/payments`);
  const r = tile(p, "refunds");
  await expect(r).toBeVisible();
  expect(await dashed(r)).toBe("dashed");
  await p.goto(`${w.url}/map`);
  const pay = tile(p, "payments");
  await expect(pay).toBeVisible();
  expect(await dashed(pay)).not.toBe("dashed");
  expect(await family(pay, "background-color")).not.toBe("gray");
  await p.goto(`${w.url}/map/payments`);
  // grey: the ghost tile's border and background come from the grey palette
  expect([await family(r, "border-top-color"), await family(r, "background-color")]).toEqual(["gray", "gray"]);
});

test("70.2 the person accepts one ghost with the ✓ button and it becomes real", async ({ page: p }) => {
  const w = await project(undefined, payments);
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  await p.goto(`${w.url}/map/refunds`);
  const accept = p.getByRole("button", { name: "Accept" });
  await expect(accept).toBeVisible();
  const n = events(w).length;
  await accept.click();
  const hero = p.locator('article[data-card="refunds"]');
  await expect(hero).toHaveAttribute("data-proposed", "false");
  const added = events(w).slice(n);
  expect(added.filter((e) => e.type === "change.accepted" && e.payload.id === "refunds").length).toBe(1);
  expect(added.every((e) => e.actor === "you")).toBe(true);
  await expect(p.locator('[data-section="refines"] [data-id="payments"]')).toBeVisible();
  await expect(p.getByRole("button", { name: "Accept" })).toHaveCount(0);
});

test("70.3 accepting a ghost child under a ghost parent makes both real", async ({ page: p }) => {
  const w = await project(undefined, payments);
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  w.werk("add", "partial", "--title", "Partial refunds", "--parent", "refunds");
  await p.goto(`${w.url}/map/partial`);
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator('article[data-card="partial"]')).toHaveAttribute("data-proposed", "false");
  await expect(p.locator('[data-section="refines"] [data-id="refunds"]')).toBeVisible();
  await p.locator('[data-section="refines"] [data-id="refunds"] a').first().click();
  await expect(heading(p)).toHaveText("Refunds");
  await expect(p.locator('article[data-card="refunds"]')).toHaveAttribute("data-proposed", "false");
  await expect(tile(p, "partial")).toBeVisible();
  await expect(p.locator('[data-section="refines"] [data-id="payments"]')).toBeVisible();
});

test("70.4 an accept takes only the accepted card's branch, not other ghosts", async ({ page: p }) => {
  const w = await project(undefined, payments);
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  w.werk("add", "chargebacks", "--title", "Chargebacks", "--parent", "payments");
  w.werk("add", "refunds:opt0", "--kind", "option", "--title", "No refunds", "--why_not", "Customers leave");
  w.werk("link", "refunds:opt0", "refunds", "--type", "alternative_to");
  w.werk("add", "refunds:src0", "--kind", "source", "--title", "Refund study", "--finding", "Refunds keep customers");
  w.werk("link", "refunds", "refunds:src0", "--type", "supported_by");
  await p.goto(`${w.url}/map/payments`);
  await expect(p.getByRole("button", { name: /accept all|accept both|accept every/i })).toHaveCount(0);
  await p.goto(`${w.url}/map/refunds`);
  await expect(p.getByRole("button", { name: /accept all|accept both|accept every/i })).toHaveCount(0);
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator('article[data-card="refunds"]')).toHaveAttribute("data-proposed", "false");
  const opt = p.locator('[data-section="options"] li[data-id="refunds:opt0"]');
  const src = p.locator('[data-section="evidence"] li[data-id="refunds:src0"]');
  await expect(opt).toHaveAttribute("data-pending", "false");
  await expect(src).toHaveAttribute("data-pending", "false");
  await expect(opt).not.toContainText("proposed");
  await expect(src).not.toContainText("proposed");
  await p.goto(`${w.url}/map/payments`);
  const cb = tile(p, "chargebacks");
  await expect(cb).toHaveAttribute("data-proposed", "true");
  expect(await dashed(cb)).toBe("dashed");
  expect([await family(cb, "border-top-color"), await family(cb, "background-color")]).toEqual(["gray", "gray"]);
});

test("70.5 a second view sees the accept because it reads the same log", async ({ context }) => {
  const w = await project(undefined, payments);
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  const one = await context.newPage();
  const two = await context.newPage();
  await one.goto(`${w.url}/map/refunds`);
  await two.goto(`${w.url}/map/refunds`);
  await expect(two.locator('article[data-card="refunds"]')).toHaveAttribute("data-proposed", "true");
  await flag(two);
  await one.getByRole("button", { name: "Accept" }).click();
  await expect(two.locator('article[data-card="refunds"]')).toHaveAttribute("data-proposed", "false");
  expect(await same(two)).toBe(true);
});
