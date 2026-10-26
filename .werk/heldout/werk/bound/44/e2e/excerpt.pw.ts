import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decided } from "../lib.ts";
import { expect, test } from "../../e2e/support/fixtures.ts";
import type { BrowserServer } from "../../e2e/support/server.ts";

const WORDS = "seats are the unit we bill";

function setup(app: BrowserServer) {
  appendFileSync(
    join(app.dir, ".werk", "log.jsonl"),
    `${decided("seats", "We charge per seat", {
      why: "Seats are simple.",
    })
      .map((e) => JSON.stringify(e))
      .join("\n")}\n`,
  );
  const dir = join(app.dir, ".werk", "chats");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "pricing.jsonl"),
    `${JSON.stringify({
      speaker: "person",
      at: "10:02",
      session: "6ae61be7",
      kind: "spoken",
      text: `yes: ${WORDS}`,
    })}\n`,
  );
}

const api = async (app: BrowserServer, path: string) => {
  const name = new URL(app.url).pathname.split("/").pop();
  const res = await fetch(`${app.origin}/api/projects/${name}${path}`);
  return res.json() as Promise<any>;
};

const pane = (page: import("@playwright/test").Page) =>
  page.getByRole("region", { name: "Map pane" });

test("06.1 a new excerpt for a card stages as a ghost and waits for the ✓", async ({
  page,
  app,
}) => {
  setup(app);
  const before = (await api(app, "/card/seats")).card;
  expect(before.status).toBe("decided");
  const quoted = app.werk("quote", "seats", "pricing", WORDS);
  expect(quoted.code, quoted.stderr).toBe(0);
  expect(quoted.stdout).toContain("proposed");
  expect(quoted.stdout).not.toContain("added");

  const shape = await api(app, "/graph?shape=1");
  const node = shape.nodes.find((n: any) => n.kind === "excerpt");
  expect(node.proposed).toBe(true);
  const edge = shape.edges.find(
    (e: any) => e.from === "seats" && e.to === node.id,
  );
  expect(edge.held).toBe(true);

  await page.goto(`${app.url}/map/seats`);
  const row = pane(page).locator(".evidence-row").first();
  await expect(row).toBeVisible();
  await expect(row).toHaveClass(/is-proposed/);

  const after = (await api(app, "/card/seats")).card;
  expect(after.status).toBe("decided");
  expect(after.title).toBe(before.title);
  expect(after.why).toBe(before.why);
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async ({
  page,
  app,
}) => {
  setup(app);
  expect(app.werk("quote", "seats", "pricing", WORDS).code).toBe(0);
  await page.goto(`${app.url}/map/seats:ex0`);
  const hero = pane(page).locator(".hero");
  await expect(hero).toHaveClass(/is-proposed/);
  await hero.getByRole("button", { name: "Accept the proposal" }).click();
  await expect(hero).not.toHaveClass(/is-proposed/);

  await page.goto(`${app.url}/map/seats`);
  const row = pane(page).locator(".evidence-row");
  await expect(row).toHaveCount(1);
  await expect(row.first()).not.toHaveClass(/is-proposed/);
  await expect(row.first()).toContainText(WORDS);
  await expect(
    pane(page).getByText("Evidence and excerpts"),
  ).toBeVisible();
  const shape = await api(app, "/graph?shape=1");
  const edge = shape.edges.find(
    (e: any) => e.from === "seats" && e.to === "seats:ex0",
  );
  expect(edge.held).toBe(false);
});
