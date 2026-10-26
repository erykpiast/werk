// Held-out steps 06.1 and 06.2: a quoted excerpt stages as a ghost and goes live on the ✓.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

async function decidedCardWithChat(): Promise<Werk> {
  const w = await project();
  w.seed("node.added", {
    id: "pricing",
    kind: "card",
    title: "Price per seat",
    body: "One seat, one price.",
    parent: "root",
  });
  w.seed("node.decided", { id: "pricing" });
  mkdirSync(join(w.dir, ".werk", "chats"));
  const line = {
    speaker: "person",
    at: "2026-01-01T10:00:00Z",
    session: "s1",
    kind: "spoken",
    text: "a seat is what we charge for",
  };
  writeFileSync(join(w.dir, ".werk", "chats", "talk.jsonl"), `${JSON.stringify(line)}\n`);
  return w;
}

const logLines = (w: Werk) =>
  readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean);
const sayRows = (p: Page) => p.locator('[data-section="say"] [data-link="supported_by"]');

test("06.1 a new excerpt for a card stages as a ghost and waits for the check mark", async ({ page: p }) => {
  const w = await decidedCardWithChat();
  const out = w.werk("quote", "pricing", "talk", "what we charge for");
  expect(out).toContain("proposed");
  expect(out).not.toContain("added");

  await p.goto(`${w.url}/map/pricing`);
  // The card keeps its status and its words.
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Price per seat");
  await expect(p.locator('[data-tag="status"]')).toHaveText("decided");
  await expect(p.locator('[data-field="body"]')).toContainText("One seat, one price.");
  // The link from the card to the excerpt shows as pending.
  const row = sayRows(p);
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("what we charge for");
  await expect(row).toHaveAttribute("data-pending", "true");

  // The excerpt itself shows as a ghost, waiting for the ✓.
  await p.goto(`${w.url}/map/pricing:ex0`);
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "true");
  await expect(p.getByRole("button", { name: /accept/i })).toBeVisible();
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async ({ page: p }) => {
  const w = await decidedCardWithChat();
  w.werk("quote", "pricing", "talk", "what we charge for");
  await p.goto(`${w.url}/map/pricing:ex0`);
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "true");

  const before = logLines(w).length;
  await p.getByRole("button", { name: /accept/i }).click();
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "false");
  await expect(p.getByRole("button", { name: /accept/i })).toHaveCount(0);
  // Exactly one accept: no second accept for the link.
  const added = logLines(w)
    .slice(before)
    .map((line) => JSON.parse(line).type);
  expect(added).toEqual(["change.accepted"]);

  await p.goto(`${w.url}/map/pricing`);
  const row = sayRows(p);
  await expect(row).toContainText("what we charge for");
  await expect(row).toHaveAttribute("data-pending", "false");
  expect(w.werk("show", "pricing")).not.toContain("held");
});
