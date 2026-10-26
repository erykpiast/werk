// Held-out steps 18.1–18.5: proposals, pending edits and removals in the browser.
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../../e2e/project.ts";

test.afterEach(stop);

function card(w: Pick<Werk, "seed">, id: string, fields: Record<string, unknown> = {}): void {
  w.seed("node.added", { id, kind: "card", title: id, parent: "root", status: "decided", who: "me", ...fields });
}

const flagPage = (p: Page) =>
  p.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });
const stillSamePage = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);
const logLines = (w: Werk) =>
  readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { seq: number; actor: string; type: string; payload: Record<string, unknown> });
const classes = async (p: Page, selector: string) =>
  ((await p.locator(selector).getAttribute("class")) ?? "").split(/\s+/);

test("18.1 the ✓ on a proposed new card makes it real without a reload", async ({ page: p }) => {
  const w = await project(undefined, (down) => card(down, "storage", { title: "Storage" }));
  w.werk("add", "use-sqlite", "--title", "Use SQLite", "--parent", "storage");
  await p.goto(`${w.url}/map/storage`);
  await p.locator('a[data-tile="use-sqlite"]').click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Use SQLite");
  const article = p.locator("article");
  const look = await classes(p, "article");
  expect(look).toContain("border-blue-400");
  expect(look).toContain("bg-blue-50");
  await expect(article.locator('[data-tag="proposed"]')).toHaveText("proposed");
  const actions = article.locator('[data-role="actions"]');
  await expect(actions.getByRole("button", { name: "Accept" })).toHaveText(/✓/);
  await expect(p.getByRole("button", { name: /discard/i })).toHaveCount(0);

  const before = logLines(w).length;
  await flagPage(p);
  await actions.getByRole("button", { name: "Accept" }).click();
  await expect(article).toHaveAttribute("data-proposed", "false");
  await expect(article.locator('[data-tag="proposed"]')).toHaveCount(0);
  const after = await classes(p, "article");
  expect(after).not.toContain("border-blue-400");
  expect(after).not.toContain("bg-blue-50");
  expect(await stillSamePage(p)).toBe(true);
  const events = logLines(w).slice(before);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ type: "change.accepted", actor: "you", payload: { id: "use-sqlite" } });

  // The same accept from the command line, on a second ghost, writes an event of the same shape.
  w.werk("add", "use-pg", "--title", "Use Postgres", "--parent", "storage");
  w.werk("accept", "use-pg", "--actor", "you");
  const cli = logLines(w).at(-1);
  expect(cli).toMatchObject({ type: "change.accepted", actor: "you", payload: { id: "use-pg" } });
  expect(Object.keys(cli?.payload ?? {})).toEqual(Object.keys(events[0]?.payload ?? {}));
  const show = w.werk("show", "use-sqlite");
  expect(show).not.toContain("proposed");
});

test("18.2 a pending edit to a decided card shows a word diff and the ✓ amends it", async ({ page: p }) => {
  // A decided card that meets the decide contract: a decided parent as its basis and a kill criterion.
  const w = await project(undefined, (down) => {
    down.seed("node.decided", { id: "root" });
    card(down, "cache-layer", {
      title: "Cache layer",
      why: "Reads are slow",
      body: "Entries expire after five minutes.",
    });
    down.werk("kill", "cache-layer", "--revisit");
  });
  w.werk(
    "propose",
    "cache-layer",
    "--ops",
    JSON.stringify([
      { tag: "elaborated", old: "Entries expire after five minutes.", new: "Entries expire after ten minutes." },
    ]),
  );
  await p.goto(`${w.url}/map/cache-layer`);
  const article = p.locator("article");
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Cache layer");
  const look = await classes(p, "article");
  expect(look).toContain("border-blue-400");
  expect(look).not.toContain("bg-blue-50");
  // No badge in the card reads "proposed".
  await expect.soft(article.locator('[data-role="tags"] [data-tag]', { hasText: /^proposed$/i })).toHaveCount(0);

  const body = p.locator('[data-field="body"]');
  await expect(body.locator('ins[data-diff="added"]')).toHaveText("ten");
  await expect(body.locator('del[data-diff="removed"]')).toHaveText("five");
  expect(await body.locator("ins").getAttribute("class")).toContain("bg-blue-100");
  expect(await body.locator("del").getAttribute("class")).toContain("bg-blue-100");
  expect(await body.locator("del").evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe("line-through");
  await expect(article.locator("[data-diff]")).toHaveCount(2);
  await expect(p.getByRole("heading", { level: 1 }).locator("[data-diff]")).toHaveCount(0);
  await expect(p.locator('[data-field="why"] [data-diff]')).toHaveCount(0);

  await flagPage(p);
  await article.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator("[data-diff]")).toHaveCount(0);
  await expect(body).toHaveText("Entries expire after ten minutes.");
  expect(await stillSamePage(p)).toBe(true);
});

test("18.3 one added item in a long list marks only that item", async ({ page: p }) => {
  const items = Array.from({ length: 10 }, (_, i) => `- item ${i + 1}`).join("\n");
  const para = "Each item is a step.";
  const w = await project(undefined, (down) => card(down, "steps", { title: "Steps", body: `${items}\n\n${para}` }));
  const longer = items.replace("- item 5", "- item 5\n- a new item");
  w.werk(
    "propose",
    "steps",
    "--ops",
    JSON.stringify([
      { tag: "elaborated", old: items, new: longer },
      { tag: "elaborated", old: para, new: "- Each item\n- is a step." },
    ]),
  );
  await p.goto(`${w.url}/map/steps`);
  const body = p.locator('[data-field="body"]');
  await expect(body.locator("ins", { hasText: "a new item" }).first()).toBeVisible();
  const added = body.locator("li", { hasText: "a new item" });
  expect(await added.locator("ins").first().getAttribute("class")).toContain("bg-blue-100");
  for (let i = 1; i <= 10; i++) {
    const old = body.locator("li").filter({ hasText: new RegExp(`^item ${i}$`) });
    await expect(old).toHaveCount(1);
    await expect(old.locator("[data-diff]")).toHaveCount(0);
  }
  const removed = body.locator('[data-diff="removed"]', { hasText: para });
  await expect(removed).toHaveCount(1);
  expect(await removed.getAttribute("class")).toContain("bg-blue-100");
  expect(await removed.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe("line-through");
  const newList = body.locator('div[data-diff="added"]');
  await expect(newList.locator("li")).toHaveCount(2);
  expect(await newList.getAttribute("class")).toContain("bg-blue-100");
});

test("18.4 the ✕ on a card with two children offers subtree or reparent, and a restore brings it back", async ({
  page: p,
}) => {
  const w = await project(undefined, (down) => {
    card(down, "server", { title: "Server" });
    card(down, "auth", { title: "Auth", parent: "server" });
    card(down, "tokens", { title: "Tokens", parent: "auth" });
    card(down, "sessions", { title: "Sessions", parent: "auth" });
  });
  await p.goto(`${w.url}/map/server`);
  await p.locator('a[data-tile="auth"]').click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Auth");
  const before = await p.locator("#card").innerHTML();

  await p.getByRole("button", { name: "Remove" }).click();
  const dialog = p.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const answers = dialog.getByRole("button");
  await expect(answers).toHaveCount(3);
  await expect(dialog.getByRole("button", { name: /subtree.*3 cards leave/ })).toBeVisible();
  const reparent = dialog.getByRole("button", { name: /1 card leaves.*children move up to.*Server/ });
  await expect(reparent).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();

  const count = logLines(w).length;
  await flagPage(p);
  await reparent.click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Server");
  await expect(p.locator('[data-tile="auth"]')).toHaveCount(0);
  await expect(p.locator('[data-tile="tokens"]')).toBeVisible();
  await expect(p.locator('[data-tile="sessions"]')).toBeVisible();
  expect(await stillSamePage(p)).toBe(true);
  const events = logLines(w).slice(count);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ type: "node.removed", payload: { id: "auth", reparent: true } });

  w.werk("restore", "auth", "--actor", "you");
  await expect(p.locator('[data-tile="auth"]')).toBeVisible();
  await expect(p.locator('[data-tile="tokens"]')).toHaveCount(0);
  await p.locator('a[data-tile="auth"]').click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Auth");
  expect(await p.locator("#card").innerHTML()).toBe(before);
});

function send(url: string, path: string, body: string) {
  const { port } = new URL(url);
  return new Promise<number>((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: { host: `localhost:${port}`, "content-type": "application/json" },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

test("18.5a an agent proposes to remove a card, and the map draws it in red", async ({ page: p }) => {
  const w = await project(undefined, (down) => card(down, "legacy-importer", { title: "Legacy importer" }));
  // The command line offers no way for an agent to propose a removal: no verb and no flag names one.
  const help = w.werk("help");
  const removalProposal = /propose[^\n]*remov|remov[^\n]*propos/i.test(
    help
      .split("\n")
      .filter((l) => !l.includes('{"tag":"removed"'))
      .join("\n"),
  );
  expect(removalProposal, "werk help names a way to propose a removal").toBe(true);
  await p.goto(`${w.url}/map/legacy-importer`);
  const look = await classes(p, "article");
  expect(look.some((c) => /red/.test(c))).toBe(true);
});

test("18.5b cancel on the ✕ changes nothing, and a write without the token is refused", async ({ page: p }) => {
  const w = await project(undefined, (down) => {
    card(down, "legacy-importer", { title: "Legacy importer" });
    card(down, "old-notes", { title: "Old notes" });
  });
  await p.goto(`${w.url}/map/root`);
  await p.locator('a[data-tile="old-notes"]').click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Old notes");
  const count = logLines(w).length;
  await p.getByRole("button", { name: "Remove" }).click();
  await p.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(p.getByRole("dialog")).toHaveCount(0);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Old notes");
  expect(logLines(w).length).toBe(count);

  const page = await p.locator("#card").innerHTML();
  const status = await send(w.url, "/api/remove", JSON.stringify({ id: "legacy-importer" }));
  expect(status).toBeGreaterThanOrEqual(400);
  expect(logLines(w).length).toBe(count);
  await p.waitForTimeout(500);
  expect(await p.locator("#card").innerHTML()).toBe(page);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Old notes");
});
