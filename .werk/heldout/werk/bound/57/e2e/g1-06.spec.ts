import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decided } from "../../src/map/mark-fixtures.ts";
import { expect, test } from "../../e2e/support/fixtures.ts";

const leftPane = (page: import("@playwright/test").Page) =>
  page.getByRole("region", { name: "Map pane" });

function setup(app: { dir: string; werk: (...a: string[]) => { code: number; stdout: string; stderr: string } }) {
  const events = decided("auth", { title: "Auth card", why: "Why words", parent: "root" });
  appendFileSync(join(app.dir, ".werk", "log.jsonl"), events.map((e) => `${JSON.stringify(e)}\n`).join(""));
  mkdirSync(join(app.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(
    join(app.dir, ".werk", "chats", "pricing.jsonl"),
    `${JSON.stringify({ speaker: "person", at: "10:02", session: "6ae61be7", kind: "spoken", text: "yes: seats are the unit we bill" })}\n`,
  );
  const q = app.werk("quote", "auth", "pricing", "seats are the unit we bill");
  expect(q.code).toBe(0);
  expect(q.stdout).toContain("proposed");
}

test("06.1 the excerpt is a ghost, the link is pending, the card keeps its words", async ({ page, app }) => {
  setup(app);
  await page.goto(`${app.url}/map/auth`);
  const hero = leftPane(page).locator(".hero");
  await expect(hero.getByRole("heading", { level: 1, name: "Auth card" })).toBeVisible();
  await expect(hero).not.toHaveClass(/is-proposed/);
  const row = leftPane(page).locator(".evidence-row");
  await expect(row).toHaveCount(1);
  await expect(row).toHaveClass(/is-proposed/);
  await expect(row.locator(".tag-pending-link")).toHaveText("pending");
  await expect(leftPane(page).getByText("Why words")).toBeVisible();
});

test("06.2 the ✓ on the excerpt makes it real and the link live", async ({ page, app }) => {
  setup(app);
  await page.goto(`${app.url}/map/auth:ex0`);
  const hero = leftPane(page).locator(".hero");
  await expect(hero).toHaveClass(/is-proposed/);
  await hero.getByRole("button", { name: "Accept the proposal" }).click();
  await expect(hero).not.toHaveClass(/is-proposed/);
  await page.goto(`${app.url}/map/auth`);
  const row = leftPane(page).locator(".evidence-row");
  await expect(row).toHaveCount(1);
  await expect(row).not.toHaveClass(/is-proposed/);
  await expect(row.locator(".tag-pending-link")).toHaveCount(0);
  await expect(row).toContainText("seats are the unit we bill");
});
