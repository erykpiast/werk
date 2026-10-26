import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "../e2e/support/fixtures.ts";

test("06.1 a new excerpt stages as a ghost with a pending link; the card keeps its words", async ({
  page,
  app,
}) => {
  // Given a decided card
  expect(app.werk("add", "d", "--title", "We charge per seat", "--parent", "root").code).toBe(0);
  expect(app.werk("accept", "d", "--actor", "you").code).toBe(0);
  const chats = join(app.dir, ".werk", "chats");
  mkdirSync(chats, { recursive: true });
  writeFileSync(
    join(chats, "talk.jsonl"),
    `${JSON.stringify({ speaker: "person", at: "10:02", session: "s1", kind: "spoken", text: "yes: seats are the unit we bill" })}\n`,
  );
  await page.goto(`${app.url}/map/d`);
  const hero = page.getByRole("region", { name: "Map pane" }).locator(".hero");
  await expect(hero).not.toHaveClass(/is-proposed/);
  const before = await hero.innerText();

  // When an agent adds an excerpt that supports that card
  const quoted = app.werk("quote", "d", "talk", "seats are the unit we bill");
  expect(quoted.code, quoted.stderr).toBe(0);

  // Then the command output says "proposed", not "added"
  expect(quoted.stdout).toContain("proposed");
  expect(quoted.stdout).not.toContain("added");

  // And the map shows the excerpt as a ghost, with a pending link
  await page.goto(`${app.url}/map/d`);
  const row = page.locator('li.evidence-row[data-card-id="d:ex0"]');
  await expect(row).toHaveClass(/is-proposed/);
  await expect(row.locator(".tag-pending-link")).toHaveText("pending");

  // And the card keeps its status and words
  await expect(hero).not.toHaveClass(/is-proposed/);
  expect(await hero.innerText()).toBe(before);
  expect(app.werk("show", "d").stdout).toContain("We charge per seat");
});
