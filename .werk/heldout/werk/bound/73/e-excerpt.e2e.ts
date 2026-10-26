// Held-out steps 06.1 and 06.2: a new excerpt waits as a ghost until the person gives the ✓.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

async function decided(): Promise<Werk> {
  const w = await project();
  w.seed("node.added", {
    id: "billing",
    kind: "card",
    title: "We bill per seat",
    why: "Seats track value",
    body: "Each seat costs the same.",
    parent: "root",
  });
  w.seed("node.decided", { id: "billing" });
  mkdirSync(join(w.dir, ".werk", "chats"));
  const line = { speaker: "person", at: "t0", session: "s1", kind: "spoken", text: "seats are the unit we bill" };
  writeFileSync(join(w.dir, ".werk", "chats", "pricing.jsonl"), `${JSON.stringify(line)}\n`);
  return w;
}

test("06.1 a new excerpt stages as a ghost and waits for the ✓", async ({ page: p }) => {
  const w = await decided();
  const out = w.werk("quote", "billing", "pricing", "seats are the unit");
  expect(out).toContain("proposed");
  expect(out).not.toContain("added");

  await p.goto(`${w.url}/map/billing`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("We bill per seat");
  await expect(p.locator('[data-tag="status"]')).toHaveText("decided");
  await expect(p.locator("article[data-card]")).toContainText("Each seat costs the same.");
  await expect(p.locator("article[data-card]")).toContainText("Seats track value");
  const row = p.locator('[data-link="supported_by"]').filter({ hasText: "seats are the unit" });
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute("data-pending", "true");
  await expect(row).toContainText("pending");

  await p.goto(`${w.url}/map/billing:ex0`);
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "true");
  await expect(p.getByRole("button", { name: /accept/i })).toBeVisible();
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async ({ page: p }) => {
  const w = await decided();
  w.werk("quote", "billing", "pricing", "seats are the unit");
  await p.goto(`${w.url}/map/billing:ex0`);
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "true");
  await p.getByRole("button", { name: /accept/i }).click();
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "false");

  await p.goto(`${w.url}/map/billing`);
  const row = p.locator('[data-link="supported_by"]').filter({ hasText: "seats are the unit" });
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute("data-pending", "false");
  await expect(row).not.toContainText("pending");
  expect(w.werk("show", "billing")).not.toContain("held");
});
