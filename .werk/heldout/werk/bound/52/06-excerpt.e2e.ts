import { expect, test } from "@playwright/test";
import { project } from "./e2e-helpers.ts";

const said = [{ speaker: "person", at: "2026-01-02T10:00:00Z", session: "sess-1", kind: "spoken", text: "we must retry a failed payment once" }];

test("06.1 a new excerpt for a card stages as a ghost and waits for the ✓", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "retry", kind: "card", title: "Payments retry once", why: "cards fail by chance", parent: "root" });
  w.seed("node.decided", { id: "retry" });
  w.chat("pay", said);
  const out = w.werk("quote", "retry", "pay", "retry a failed payment once");
  expect(out).toContain("proposed");
  expect(out).not.toContain("added");
  await p.goto(`${w.url}/map/retry:ex0`);
  expect.soft(await p.locator('[data-tag="proposed"]').count(), "the excerpt page shows it as a ghost").toBe(1);
  expect.soft(await p.getByRole("button", { name: /✓|accept/i }).count(), "a ✓ control on the excerpt").toBeGreaterThan(0);
  await p.goto(`${w.url}/map/retry`);
  const link = p.locator('#card a[href="/map/retry%3Aex0"], #card a[href="/map/retry:ex0"]');
  expect.soft(await link.count(), "the card page shows the link to the excerpt").toBeGreaterThan(0);
  await expect(p.locator('[data-tag="status"]')).toHaveText("decided");
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Payments retry once");
  await expect(p.locator('#card [data-field="why"]')).toContainText("cards fail by chance");
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "retry", kind: "card", title: "Payments retry once", parent: "root" });
  w.seed("node.decided", { id: "retry" });
  w.chat("pay", said);
  w.werk("quote", "retry", "pay", "retry a failed payment once");
  await p.goto(`${w.url}/map/retry:ex0`);
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(1);
  // The person gives the excerpt the ✓ in the map.
  await expect(p.getByRole("button", { name: /✓|accept/i }), "no ✓ control on the excerpt page").toHaveCount(1, { timeout: 3000 });
});

test("06.2 probe: accept through the command line, then look at the card view", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "retry", kind: "card", title: "Payments retry once", parent: "root" });
  w.seed("node.decided", { id: "retry" });
  w.chat("pay", said);
  w.werk("quote", "retry", "pay", "retry a failed payment once");
  w.werk("accept", "retry:ex0", "--actor", "you");
  await p.goto(`${w.url}/map/retry:ex0`);
  expect.soft(await p.locator('[data-tag="proposed"]').count(), "excerpt no longer a ghost").toBe(0);
  const show = w.werk("show", "retry");
  expect.soft(show, "CLI link live").toMatch(/-> supported_by\s+retry:ex0  retry a failed payment once\n/);
  await p.goto(`${w.url}/map/retry`);
  expect.soft(await p.locator("#card").textContent(), "card view shows the excerpt").toContain("retry a failed payment once");
});
