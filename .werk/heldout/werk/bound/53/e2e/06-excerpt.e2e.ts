// 06.1, 06.2: an excerpt that an agent adds stages as a ghost, and the person's ✓ makes it real.
import { expect, test } from "@playwright/test";
import { cleanup, project, type Werk } from "./harness";

test.afterEach(cleanup);

async function decidedCardWithChat(): Promise<Werk> {
  const w = await project();
  w.seed("node.added", {
    id: "retry",
    kind: "card",
    title: "Retry payment once",
    why: "A second try recovers most card declines.",
    body: "The checkout retries a failed payment one time.",
    status: "decided",
    who: "me",
    parent: "root",
  });
  w.chat("pay", [
    { speaker: "person", at: "2026-10-01T10:00:00Z", session: "s1", kind: "spoken", text: "should we retry a failed payment?" },
    { speaker: "agent", at: "2026-10-01T10:01:00Z", session: "s1", kind: "spoken", text: "we retry a failed payment exactly once" },
  ]);
  return w;
}

test("06.1 a new excerpt for a card stages as a ghost and waits for the ✓", async ({ page: p }) => {
  const w = await decidedCardWithChat();
  const before = w.werk("show", "retry");
  // When an agent adds an excerpt that supports that card
  const out = w.werk("quote", "retry", "pay", "we retry a failed payment exactly once");
  // Then the command output says "proposed", not "added"
  expect.soft(out).toContain("proposed");
  expect.soft(out).not.toContain("added");
  const ex = /^(\S+): proposed/.exec(out)?.[1] ?? "retry:ex0";

  // And the map shows the new excerpt as a ghost, waiting for the ✓
  await p.goto(`${w.url}/map/${ex}`);
  await expect.soft(p.locator(`article[data-card="${ex}"]`)).toHaveAttribute("data-proposed", "true");
  await expect.soft(p.locator('[data-tag="proposed"]')).toBeVisible();
  await expect.soft(p.getByRole("button", { name: /✓|accept/i })).toBeVisible({ timeout: 3000 });

  // And the link from the card to the excerpt shows as pending
  await p.goto(`${w.url}/map/retry`);
  const link = p.locator(`a[href="/map/${encodeURIComponent(ex)}"], a[href="/map/${ex}"]`);
  await expect.soft(link).toHaveCount(1, { timeout: 3000 });
  await expect.soft(p.locator("main")).toContainText(/proposed|pending|held/i, { timeout: 3000 });

  // And the card keeps its status and its words until the ✓ is given
  await expect.soft(p.locator('article[data-card="retry"] [data-tag="status"]')).toHaveText("decided");
  await expect.soft(p.locator('article[data-card="retry"] h1')).toHaveText("Retry payment once");
  await expect.soft(p.locator('article[data-card="retry"] [data-field="body"]')).toContainText(
    "The checkout retries a failed payment one time.",
  );
  const after = w.werk("show", "retry");
  expect.soft(after.split("\n").slice(0, 2)).toEqual(before.split("\n").slice(0, 2));
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async ({ page: p }) => {
  const w = await decidedCardWithChat();
  const out = w.werk("quote", "retry", "pay", "we retry a failed payment exactly once");
  const ex = /^(\S+): proposed/.exec(out)?.[1] ?? "retry:ex0";
  await p.goto(`${w.url}/map/${ex}`);
  await expect(p.locator(`article[data-card="${ex}"]`)).toHaveAttribute("data-proposed", "true");

  // When the person gives the excerpt the ✓
  await p.getByRole("button", { name: /✓|accept/i }).click({ timeout: 5000 });
  // Then the excerpt is no longer a ghost
  await expect(p.locator(`article[data-card="${ex}"]`)).toHaveAttribute("data-proposed", "false");
  // And the person opens the card view and sees the excerpt under the card as supporting evidence
  await p.goto(`${w.url}/map/retry`);
  await expect(p.locator("main")).toContainText("we retry a failed payment exactly once");
  // And the link from the card to the excerpt is live without a second accept
  expect(w.werk("show", "retry")).not.toContain("(held)");
});
