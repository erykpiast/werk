// Held-out steps 06.1-06.2: an excerpt stages as a ghost and waits for the ✓.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

async function decided(): Promise<Werk> {
  const w = await project(undefined, (d) => {
    d.seed("node.added", {
      id: "plan",
      kind: "card",
      title: "We ship weekly",
      why: "Small batches",
      body: "Every Monday.",
      parent: "root",
    });
    d.seed("node.decided", { id: "plan" });
  });
  mkdirSync(join(w.dir, ".werk", "chats"), { recursive: true });
  const line = { speaker: "person", at: "t0", session: "s1", kind: "spoken", text: "we release every week on Monday" };
  writeFileSync(join(w.dir, ".werk", "chats", "talk.jsonl"), `${JSON.stringify(line)}\n`);
  return w;
}

const said = (p: import("@playwright/test").Page) => p.locator('[data-link="supported_by"]');

test("06.1 a new excerpt stages as a ghost and waits for the ✓", async ({ page: p }) => {
  const w = await decided();
  const out = w.werk("quote", "plan", "talk", "release every week");
  expect(out).toContain("proposed");
  expect(out).not.toContain("added");

  await p.goto(`${w.url}/map/plan`);
  const row = said(p);
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute("data-pending", "true");
  await expect(row.locator('[data-mark="pending"]')).toBeVisible();
  await expect(p.locator('article [data-tag="status"]')).toHaveText("decided");
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("We ship weekly");
  await expect(p.locator('[data-field="body"]')).toHaveText("Every Monday.");
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");

  await row.getByRole("link").first().click();
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "true");
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await expect(p.getByRole("button", { name: "Accept" })).toBeVisible();
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async ({ page: p }) => {
  const w = await decided();
  w.werk("quote", "plan", "talk", "release every week");
  await p.goto(`${w.url}/map/plan`);
  await said(p).getByRole("link").first().click();
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "true");
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "false");
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);

  await p.goto(`${w.url}/map/plan`);
  const row = p.locator('[data-section="say"] [data-link="supported_by"]');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("release every week");
  await expect(row).toHaveAttribute("data-pending", "false");
  await expect(row.locator('[data-mark="pending"]')).toHaveCount(0);
  expect(w.werk("show", "plan")).not.toContain("held");
});
