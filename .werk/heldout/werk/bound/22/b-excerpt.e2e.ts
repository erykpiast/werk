import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

async function setup(): Promise<Werk> {
  const w = await project();
  w.seed("node.added", {
    id: "invoices",
    kind: "card",
    title: "Invoices go out monthly",
    body: "One invoice per month per team",
    parent: "root",
    status: "decided",
  });
  mkdirSync(join(w.dir, ".werk", "chats"));
  const line = {
    speaker: "person",
    at: "2026-10-01T10:00:00Z",
    session: "s9",
    kind: "spoken",
    text: "we send one invoice a month",
  };
  writeFileSync(join(w.dir, ".werk", "chats", "billing.jsonl"), `${JSON.stringify(line)}\n`);
  return w;
}

test("06.1 a new excerpt stages as a ghost and waits for the check mark", async ({ page: p }) => {
  const w = await setup();
  const out = w.werk("quote", "invoices", "billing", "one invoice a month");
  expect(out).toContain("proposed");
  expect(out).not.toContain("added");

  await p.goto(`${w.url}/map/invoices:ex0`);
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "true");
  await expect(p.getByRole("button", { name: /accept/i })).toBeVisible();

  await p.goto(`${w.url}/map/invoices`);
  const row = p.locator('[data-section="say"] [data-link="supported_by"]');
  await expect(row).toContainText("one invoice a month");
  await expect(row).toHaveAttribute("data-pending", "true");
  await expect(p.locator('[data-tag="status"]')).toHaveText("decided");
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Invoices go out monthly");
  await expect(p.locator('[data-field="body"]')).toHaveText("One invoice per month per team");
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async ({ page: p }) => {
  const w = await setup();
  w.werk("quote", "invoices", "billing", "one invoice a month");
  await p.goto(`${w.url}/map/invoices:ex0`);
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "true");
  await p.getByRole("button", { name: /accept/i }).click();
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "false");

  await p.goto(`${w.url}/map/invoices`);
  const row = p.locator('[data-section="say"] [data-link="supported_by"]');
  await expect(row).toContainText("one invoice a month");
  await expect(row).toHaveAttribute("data-pending", "false");
  const log = w.werk("show", "invoices");
  expect(log).not.toContain("held");
});
