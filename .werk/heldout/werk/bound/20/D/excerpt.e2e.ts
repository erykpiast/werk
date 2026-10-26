// Held-out steps 06.1 and 06.2: a new excerpt stages as a ghost and waits for the ✓.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { project, stop, type Werk } from "../../e2e/project.ts";

test.afterEach(stop);

async function decided(): Promise<Werk> {
  const w = await project(undefined, (down) => {
    down.seed("node.added", {
      id: "billing",
      kind: "card",
      title: "We bill per seat",
      why: "Seats track value",
      body: "Each seat is billed monthly.",
      parent: "root",
      status: "decided",
      who: "me",
    });
  });
  mkdirSync(join(w.dir, ".werk", "chats"));
  const line = { speaker: "person", at: "t0", session: "s1", kind: "spoken", text: "seats are the unit we bill" };
  writeFileSync(join(w.dir, ".werk", "chats", "pricing.jsonl"), `${JSON.stringify(line)}\n`);
  return w;
}

const said = (p: import("@playwright/test").Page) => p.locator('[data-section="say"] [data-link="supported_by"]');

test("06.1 a new excerpt for a card stages as a ghost and waits for the ✓", async ({ page: p }) => {
  const w = await decided();
  const out = w.werk("quote", "billing", "pricing", "seats are the unit");
  expect(out).toContain("proposed");
  expect(out).not.toContain("added");

  await p.goto(`${w.url}/map/billing`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("We bill per seat");
  await expect(p.locator('[data-tag="status"]')).toHaveText("decided");
  await expect(p.locator('[data-field="body"]')).toContainText("Each seat is billed monthly.");
  await expect(p.locator('[data-field="why"]')).toContainText("Seats track value");
  const row = said(p);
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("seats are the unit");
  await expect(row).toHaveAttribute("data-pending", "true");
  await expect(row.locator('[data-mark="pending"]')).toBeVisible();

  await p.goto(`${w.url}/map/billing:ex0`);
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "true");
  await expect(p.getByRole("button", { name: "Accept" })).toBeVisible();
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async ({ page: p }) => {
  const w = await decided();
  w.werk("quote", "billing", "pricing", "seats are the unit");
  await p.goto(`${w.url}/map/billing:ex0`);
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "true");
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "false");
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);

  await p.goto(`${w.url}/map/billing`);
  const row = said(p);
  await expect(row).toContainText("seats are the unit");
  await expect(row).toHaveAttribute("data-pending", "false");
  await expect(row.locator('[data-mark="pending"]')).toHaveCount(0);
  expect(w.werk("show", "billing")).not.toMatch(/held|ghost/);
});
