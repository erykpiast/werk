import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import type { BrowserServer } from "./server.ts";

const seed = (app: BrowserServer) => {
  const events = [
    { type: "node.proposed", id: "pricing", kind: "card", title: "We charge per seat", why: "Seats are the unit.", status: "open" },
    { type: "node.accepted", id: "pricing", actor: "you" },
    { type: "node.edited", id: "pricing", who: "me", noBasis: "test" },
    { type: "criterion.added", id: "pricing", form: "revisit" },
    { type: "node.decided", id: "pricing" },
  ];
  appendFileSync(join(app.dir, ".werk", "log.jsonl"), events.map((e) => `${JSON.stringify(e)}\n`).join(""));
  mkdirSync(join(app.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(
    join(app.dir, ".werk", "chats", "talk.jsonl"),
    `${JSON.stringify({ speaker: "person", at: "10:02", session: "s1", kind: "spoken", text: "we bill per seat, always" })}\n`,
  );
};
const pane = (page: Page) => page.getByRole("region", { name: "Map pane" });
const base = (app: BrowserServer) => `${app.origin}${new URL(app.url).pathname}`;

test("06.1 a new excerpt stages as a ghost and waits for the check mark", async ({ page, app }) => {
  seed(app);
  const quoted = app.werk("quote", "pricing", "talk", "we bill per seat");
  expect(quoted.code).toBe(0);
  expect(quoted.stdout).toContain("proposed");
  expect(quoted.stdout).not.toContain("added");
  await page.goto(`${base(app)}/map/pricing:ex0`);
  await expect(pane(page).locator(".tag-proposed")).toBeVisible();
  await expect(pane(page).locator(".hero.is-proposed")).toBeVisible();
  await page.goto(`${base(app)}/map/pricing`);
  const row = pane(page).locator('.evidence-row[data-card-id="pricing:ex0"]');
  await expect(row).toBeVisible();
  await expect(row).toHaveClass(/is-proposed/);
  const shown = app.werk("show", "pricing").stdout;
  expect(shown).toMatch(/supported_by\s+pricing:ex0[^\n]*\[proposed\]\s+\[held\]/);
  await expect(pane(page).locator(".tag-status")).toHaveText("decided");
  await expect(pane(page).getByRole("heading", { level: 1 })).toHaveText("We charge per seat");
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async ({ page, app }) => {
  seed(app);
  expect(app.werk("quote", "pricing", "talk", "we bill per seat").code).toBe(0);
  await page.goto(`${base(app)}/map/pricing:ex0`);
  await expect(pane(page).locator(".tag-proposed")).toBeVisible();
  // The person gives the excerpt the check mark in the map.
  const accept = pane(page).getByRole("button", { name: /✓|accept/i });
  await expect(accept).toHaveCount(1, { timeout: 3000 });
  await accept.click();
  await expect(pane(page).locator(".tag-proposed")).toHaveCount(0);
  await page.goto(`${base(app)}/map/pricing`);
  const row = pane(page).locator('.evidence-row[data-card-id="pricing:ex0"]');
  await expect(row).toBeVisible();
  await expect(row).not.toHaveClass(/is-proposed/);
});

test("06.2b the same outcome through the accept command, for what follows the check mark", async ({ page, app }) => {
  seed(app);
  expect(app.werk("quote", "pricing", "talk", "we bill per seat").code).toBe(0);
  expect(app.werk("accept", "pricing:ex0", "--actor", "you").code).toBe(0);
  await page.goto(`${base(app)}/map/pricing`);
  const row = pane(page).locator('.evidence-row[data-card-id="pricing:ex0"]');
  await expect(row).toBeVisible();
  await expect(row).not.toHaveClass(/is-proposed/);
  expect(app.werk("show", "pricing").stdout).not.toMatch(/pricing:ex0[^\n]*\[held\]/);
});
