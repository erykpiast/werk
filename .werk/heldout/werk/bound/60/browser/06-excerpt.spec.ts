import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "../../e2e/support/fixtures.ts";
import type { BrowserServer } from "../../e2e/support/server.ts";

const WORDS = "seats are the unit we bill";
const pane = (page: import("@playwright/test").Page) =>
  page.getByRole("region", { name: "Map pane" });

/** Decides root and puts a conversation on disk, then quotes it. */
function stage(app: BrowserServer) {
  for (const step of [
    ["edit", "root", "--who", "me", "--no-basis", "top"],
    ["kill", "root", "--revisit"],
    ["status", "root", "decided"],
  ]) {
    const r = app.werk(...step);
    expect(r.code, r.stderr).toBe(0);
  }
  const dir = join(app.dir, ".werk", "chats");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "pricing.jsonl"),
    `${JSON.stringify({ speaker: "person", at: "10:02", session: "6ae61be7", kind: "spoken", text: `yes: ${WORDS}` })}\n`,
  );
  return app.werk("quote", "root", "pricing", WORDS);
}

test("06.1 a new excerpt stages as a ghost and waits for the check", async ({ page, app }) => {
  const rootBefore = app.werk("show", "root").stdout;
  const quoted = stage(app);
  expect(quoted.code, quoted.stderr).toBe(0);
  expect(quoted.stdout).toContain("proposed");
  expect(quoted.stdout).not.toMatch(/\badded\b/);

  await page.goto(`${app.url}/map/root`);
  const row = pane(page).locator(".evidence-row", { hasText: WORDS });
  await expect(row).toHaveCount(1);
  await expect(row).toHaveClass(/is-proposed/);
  await expect(row.locator(".tag-pending-link")).toBeVisible();
  // the card keeps its status and words
  await expect(pane(page).getByRole("heading", { level: 1 })).toContainText("We build software with agents");
  const shown = app.werk("show", "root").stdout;
  expect(shown).toContain("decided");
  expect(shown).toContain("One repeating pipeline keeps the work in step.");
  expect(rootBefore).toContain("open");
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async ({ page, app }) => {
  expect(stage(app).code).toBe(0);
  await page.goto(`${app.url}/map/root:ex0`);
  await pane(page).getByRole("button", { name: "Accept the proposal" }).click();
  await expect(pane(page).getByRole("button", { name: "Accept the proposal" })).toHaveCount(0);

  await page.goto(`${app.url}/map/root`);
  const row = pane(page).locator(".evidence-row", { hasText: WORDS });
  await expect(row).toHaveCount(1);
  await expect(row).not.toHaveClass(/is-proposed/);
  await expect(row.locator(".tag-pending-link")).toHaveCount(0);
  await expect(pane(page).getByRole("heading", { name: "Evidence and excerpts" })).toBeVisible();
});
