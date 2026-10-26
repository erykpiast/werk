import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

async function decided(): Promise<Werk> {
  const w = await project();
  w.seed("node.added", {
    id: "billing",
    kind: "card",
    title: "We bill per seat",
    why: "Teams grow one seat at a time",
    body: "Each seat is billed monthly",
    parent: "root",
  });
  w.seed("node.decided", { id: "billing" });
  mkdirSync(join(w.dir, ".werk", "chats"));
  const line = { speaker: "person", at: "t0", session: "s1", kind: "spoken", text: "seats are the unit we bill" };
  writeFileSync(join(w.dir, ".werk", "chats", "pricing.jsonl"), `${JSON.stringify(line)}\n`);
  return w;
}

const said = (p: Page) => p.locator('[data-link="supported_by"]').filter({ hasText: "seats are the unit" });

async function cardKept(p: Page): Promise<void> {
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("We bill per seat");
  await expect(p.locator('[data-tag="status"]')).toHaveText("decided");
  await expect(p.locator('[data-field="why"]')).toContainText("Teams grow one seat at a time");
  await expect(p.locator('[data-field="body"]')).toContainText("Each seat is billed monthly");
  await expect(p.locator("[data-diff]")).toHaveCount(0);
}

test("06.1 a new excerpt for a card stages as a ghost and waits for the ✓", async ({ page: p }) => {
  const w = await decided();
  const out = w.werk("quote", "billing", "pricing", "seats are the unit");
  expect(out).toContain("proposed");
  expect(out).not.toContain("added");

  await p.goto(`${w.url}/map/billing`);
  await cardKept(p);
  const row = said(p);
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute("data-pending", "true");
  await expect(row.locator('[data-mark="pending"]')).toBeVisible();

  await row.getByRole("link").first().click();
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "true");
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await expect(p.getByRole("button", { name: /accept/i })).toBeVisible();

  await p.goto(`${w.url}/map/billing`);
  await cardKept(p);
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async ({ page: p }) => {
  const w = await decided();
  w.werk("quote", "billing", "pricing", "seats are the unit");
  await p.goto(`${w.url}/map/billing`);
  await said(p).getByRole("link").first().click();
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();

  await p.getByRole("button", { name: /accept/i }).click();
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "false");
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);

  await p.goto(`${w.url}/map/billing`);
  const row = said(p);
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute("data-pending", "false");
  await expect(row.locator('[data-mark="pending"]')).toHaveCount(0);
  // No second accept was given: the link is live from the one ✓ on the excerpt.
  await expect(p.getByRole("button", { name: /accept/i })).toHaveCount(0);
  expect(w.werk("show", "billing")).not.toContain("held");
});
