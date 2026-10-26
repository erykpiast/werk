import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../../e2e/support/fixtures.ts";
import type { BrowserServer } from "../../e2e/support/server.ts";

const WORDS = "seats are the unit we bill";

function seed(app: BrowserServer) {
  const events = [
    { type: "node.proposed", id: "auth", kind: "card", title: "Auth is decided", status: "open" },
    { type: "node.accepted", id: "auth", actor: "you" },
    { type: "node.edited", id: "auth", who: "me", noBasis: "test" },
    { type: "criterion.added", id: "auth", form: "revisit" },
    { type: "node.decided", id: "auth" },
  ];
  appendFileSync(
    join(app.dir, ".werk", "log.jsonl"),
    events.map((e) => `${JSON.stringify(e)}\n`).join(""),
  );
  const chats = join(app.dir, ".werk", "chats");
  mkdirSync(chats, { recursive: true });
  writeFileSync(
    join(chats, "pricing.jsonl"),
    `${JSON.stringify({ speaker: "person", at: "10:02", session: "6ae61be7", kind: "spoken", text: `yes: ${WORDS}` })}\n`,
  );
}

const shape = async (app: BrowserServer) => {
  const name = app.url.split("/p/")[1];
  const res = await fetch(`${app.origin}/api/projects/${name}/graph?shape=1`);
  return (await res.json()) as {
    nodes: { id: string; proposed: boolean; status: string }[];
    edges: { from: string; to: string; type: string; held: boolean }[];
  };
};
const left = (page: Page) => page.getByRole("region", { name: "Map pane" });

test("06.1 a new excerpt for a card stages as a ghost and waits for the ✓", async ({ page, app }) => {
  seed(app);
  const quoted = app.werk("quote", "auth", "pricing", WORDS);
  expect(quoted.code, quoted.stderr).toBe(0);
  expect(quoted.stdout).toContain("proposed");
  expect(quoted.stdout).not.toContain("added");

  await page.goto(`${app.url}/map/auth`);
  const row = left(page).locator('[data-card-id="auth:ex0"]');
  await expect(row).toBeVisible();
  await expect(row).toHaveClass(/is-proposed/);
  const g = await shape(app);
  expect(g.nodes.find((n) => n.id === "auth:ex0")?.proposed).toBe(true);
  const edge = g.edges.find((e) => e.from === "auth" && e.to === "auth:ex0");
  expect(edge?.type).toBe("supported_by");
  expect(edge?.held).toBe(true);
  expect(g.nodes.find((n) => n.id === "auth")?.status).toBe("decided");
  await expect(left(page).getByRole("heading", { level: 1, name: "Auth is decided" })).toBeVisible();
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async ({ page, app }) => {
  seed(app);
  expect(app.werk("quote", "auth", "pricing", WORDS).code).toBe(0);

  await page.goto(`${app.url}/map/auth:ex0`);
  await page.getByRole("button", { name: "Accept the proposal" }).click();
  await expect(page.getByRole("button", { name: "Accept the proposal" })).toBeHidden();

  const g = await shape(app);
  expect(g.nodes.find((n) => n.id === "auth:ex0")?.proposed).toBe(false);
  await page.goto(`${app.url}/map/auth`);
  const row = left(page).locator('[data-card-id="auth:ex0"]');
  await expect(row).toBeVisible();
  await expect(row).not.toHaveClass(/is-proposed/);
  await expect(row).toContainText(WORDS);
  const edge = g.edges.find((e) => e.from === "auth" && e.to === "auth:ex0");
  expect(edge?.held).toBe(false);
});
