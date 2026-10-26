import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

const heading = (p: Page) => p.getByRole("heading", { level: 1 });
const mark = (p: Page) => p.evaluate(() => ((window as unknown as { kept: boolean }).kept = true));
const marked = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);
const logOf = (w: Pick<Werk, "dir">) =>
  readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

function card(w: Pick<Werk, "seed">, id: string, parent = "root", f: Record<string, unknown> = {}) {
  w.seed("node.added", { id, kind: "card", title: `Card ${id}`, parent, status: "decided", who: "me", ...f });
}
const full = (w: Pick<Werk, "seed">, id: string) => {
  w.seed("node.edited", { id, no_basis: "none" });
  w.seed("kill.added", { id, criterion: { form: "revisit" } });
};
const rgb = (at: Locator, prop: "backgroundColor" | "borderTopColor" | "borderLeftColor" | "color") =>
  at.evaluate((el, name) => {
    const c = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
    c.clearRect(0, 0, 1, 1);
    c.fillStyle = getComputedStyle(el)[name];
    c.fillRect(0, 0, 1, 1);
    const d = c.getImageData(0, 0, 1, 1).data;
    return [d[0] as number, d[1] as number, d[2] as number, d[3] as number];
  }, prop);
const isBlue = ([r, , b]: number[]) => (b as number) > (r as number) + 8;
const isRed = ([r, g, b]: number[]) => (r as number) > (g as number) + 8 && (r as number) > (b as number) + 8;

// ---------- 18
test("[18.1] accepting a proposed new card with the check mark makes it real without a reload", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "storage", "root", { title: "Storage" }));
  w.werk("add", "sqlite", "--title", "Use SQLite", "--parent", "storage");
  await p.goto(`${w.url}/map/sqlite`);
  const art = p.locator("article");
  expect(isBlue(await rgb(art, "borderTopColor"))).toBe(true);
  expect(isBlue(await rgb(art, "backgroundColor"))).toBe(true);
  await expect(p.locator('[data-tag="proposed"]')).toHaveText("proposed");
  await expect(p.getByRole("button", { name: "Accept" })).toBeVisible();
  await expect(p.getByRole("button", { name: /discard/i })).toHaveCount(0);
  const before = logOf(w).length;
  await mark(p);
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);
  await expect(art).toHaveAttribute("data-proposed", "false");
  expect(isBlue(await rgb(art, "backgroundColor"))).toBe(false);
  expect(await marked(p)).toBe(true);
  const ev = logOf(w).slice(before);
  expect(ev.length).toBe(1);
  expect(ev[0]).toMatchObject({ type: "change.accepted", actor: "you", payload: { id: "sqlite" } });
});

test("[18.2] a pending edit to a decided card shows as a diff and an accept amends the card", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    d.seed("node.decided", { id: "root" });
    card(d, "cache", "root", { title: "Cache layer", why: "Reads repeat.", body: "Entries expire after five minutes." });
    d.seed("kill.added", { id: "cache", criterion: { form: "revisit" } });
  });
  w.werk("propose", "cache", "--ops", JSON.stringify([{ tag: "elaborated", old: "Entries expire after five minutes.", new: "Entries expire after ten minutes." }]));
  await p.goto(`${w.url}/map/cache`);
  const art = p.locator("article");
  expect(isBlue(await rgb(art, "borderTopColor"))).toBe(true);
  expect(isBlue(await rgb(art, "backgroundColor"))).toBe(false);
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);
  const ins = art.locator('ins[data-diff="added"]');
  const del = art.locator('del[data-diff="removed"]');
  await expect(ins).toHaveText("ten");
  await expect(del).toHaveText("five");
  expect(isBlue(await rgb(ins, "backgroundColor"))).toBe(true);
  expect(isBlue(await rgb(del, "backgroundColor"))).toBe(true);
  expect(await del.evaluate((e) => getComputedStyle(e).textDecorationLine)).toBe("line-through");
  await expect(art.locator("[data-diff]")).toHaveCount(2);
  await mark(p);
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(art.locator("[data-diff]")).toHaveCount(0);
  await expect(art.locator('[data-field="body"]')).toHaveText("Entries expire after ten minutes.");
  expect(await marked(p)).toBe(true);
});

test("[18.3] one added item in a long list marks only that item", async ({ page: p }) => {
  const items = Array.from({ length: 10 }, (_, i) => `- step ${i + 1}`).join("\n");
  const w = await project(undefined, (d) => {
    d.seed("node.decided", { id: "root" });
    card(d, "seat", "root", { title: "Seats", body: `Seats are counted monthly.\n\n${items}` });
    d.seed("kill.added", { id: "seat", criterion: { form: "revisit" } });
  });
  const longer = items.replace("- step 5", "- step 5\n- a new step");
  w.werk("propose", "seat", "--ops", JSON.stringify([
    { tag: "elaborated", old: "Seats are counted monthly.", new: "- alpha\n- beta" },
    { tag: "elaborated", old: items, new: longer },
  ]));
  await p.goto(`${w.url}/map/seat`);
  const body = p.locator('[data-field="body"]');
  await expect(body.locator("li").filter({ hasText: "a new step" }).locator('ins[data-diff="added"], [data-diff="added"]').first()).toBeVisible();
  for (let i = 1; i <= 10; i++) await expect(body.locator("li", { hasText: new RegExp(`^step ${i}$`) }).locator("[data-diff]")).toHaveCount(0);
  await expect(body.locator('[data-diff="removed"]').first()).toContainText("monthly");
  expect(await body.locator('[data-diff="removed"]').first().evaluate((e) => getComputedStyle(e).textDecorationLine)).toBe("line-through");
  expect(isBlue(await rgb(body.locator('[data-diff="removed"]').first(), "backgroundColor"))).toBe(true);
  await expect(body.locator('div[data-diff="added"]', { hasText: "alpha" })).toBeVisible();
  expect(isBlue(await rgb(body.locator('div[data-diff="added"]'), "backgroundColor"))).toBe(true);
});

test("[18.4] removing a card with two children offers the subtree or the reparent, each with its count", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "server", "root", { title: "Server" });
    card(d, "auth", "server", { title: "Auth" });
    card(d, "tokens", "auth", { title: "Tokens" });
    card(d, "sessions", "auth", { title: "Sessions" });
  });
  await p.goto(`${w.url}/map/auth`);
  await p.getByRole("button", { name: "Remove" }).click();
  const dialog = p.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: /Remove the subtree: 3 cards leave/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Remove only #auth: 1 card leaves, 2 children move up to #server/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
  const before = logOf(w).length;
  await mark(p);
  await dialog.getByRole("button", { name: /Remove only/ }).click();
  await expect(p).toHaveURL(/\/map\/server$/);
  await expect(p.locator('[data-tile="auth"]')).toHaveCount(0);
  await expect(p.locator('[data-tile="tokens"]')).toBeVisible();
  await expect(p.locator('[data-tile="sessions"]')).toBeVisible();
  expect(await marked(p)).toBe(true);
  expect(logOf(w).length).toBe(before + 1);
  expect(logOf(w).at(-1).type).toBe("node.removed");
  w.werk("restore", "auth", "--actor", "you");
  await expect(p.locator('[data-tile="auth"]')).toBeVisible();
  await expect(p.locator('[data-tile="tokens"]')).toHaveCount(0);
  await p.goto(`${w.url}/map/auth`);
  await expect(p.locator('[data-tile="tokens"]')).toBeVisible();
  await expect(p.locator('[data-tile="sessions"]')).toBeVisible();
});

test("[18.5] a proposed removal shows in red, cancel changes nothing, and a write without the token is refused", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "legacy", "root", { title: "Legacy importer" });
    card(d, "notes", "root", { title: "Old notes" });
  });
  w.werk("propose", "legacy", "--remove");
  await p.goto(`${w.url}/map/legacy`);
  expect(isRed(await rgb(p.locator("article"), "backgroundColor"))).toBe(true);
  await p.goto(`${w.url}/map/notes`);
  const before = readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8");
  await p.getByRole("button", { name: "Remove" }).click();
  await p.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(heading(p)).toHaveText("Old notes");
  expect(readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8")).toBe(before);
  const status = await p.evaluate(async () => (await fetch("/api/remove", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "notes" }) })).status);
  expect(status).toBe(403);
  expect(readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8")).toBe(before);
  await expect(heading(p)).toHaveText("Old notes");
});

// ---------- 69
test("[69.1] the map shows the fixture project as a refines tree", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "c1", "root", { title: "Child one" });
    card(d, "c2", "root", { title: "Child two" });
    card(d, "g1", "c1", { title: "Grandchild" });
  });
  await p.goto(`${w.url}/map`);
  await expect(heading(p)).toHaveText("Root");
  await expect(p.locator('[data-tile="c1"]')).toBeVisible();
  await expect(p.locator('[data-tile="c2"]')).toBeVisible();
  await expect(p.locator('[data-tile="g1"]')).toHaveCount(0);
  await p.locator('[data-tile="c1"]').click();
  await expect(p.locator('[data-tile="g1"]')).toBeVisible();
});

test("[69.2] a card added and accepted from the command line appears with no reload", async ({ page: p }) => {
  const w = await project();
  await p.goto(`${w.url}/map`);
  await expect(p.locator("#view")).not.toContainText("Use an append-only log");
  await mark(p);
  w.werk("add", "log", "--title", "Use an append-only log", "--parent", "root");
  w.werk("accept", "log", "--actor", "you");
  await expect(p.locator('[data-tile="log"]')).toBeVisible();
  await expect(p.locator('[data-tile="log"] [data-tag="proposed"]')).toHaveCount(0);
  expect(await marked(p)).toBe(true);
});

test("[69.3] the open card survives a reload and has no control that edits its text", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "child", "root", { title: "Child", body: "A body." }));
  await p.goto(`${w.url}/map`);
  await p.locator('[data-tile="child"]').click();
  await expect(p).toHaveURL(/\/map\/child$/);
  await expect(heading(p)).toHaveText("Child");
  const view = p.locator("#view");
  await expect(view.locator("input[type=text], textarea, [contenteditable=true]")).toHaveCount(1); // the note box only
  await expect(view.getByRole("textbox")).toHaveCount(1);
  await expect(view.getByRole("textbox", { name: "Note" })).toHaveCount(1);
  for (const name of [/edit/i, /rename/i, /retitle/i, /save/i]) await expect(view.getByRole("button", { name })).toHaveCount(0);
  await p.reload();
  await expect(p).toHaveURL(/\/map\/child$/);
  await expect(heading(p)).toHaveText("Child");
});

// ---------- 70
test("[70.1] a proposed card shows as a ghost under its proposed parent", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "payments", "root", { title: "Payments" }));
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  await p.goto(`${w.url}/map/payments`);
  const ghost = p.locator('[data-tile="refunds"]');
  await expect(ghost).toHaveAttribute("data-proposed", "true");
  expect(await ghost.evaluate((e) => getComputedStyle(e).borderTopStyle)).toBe("dashed");
  await p.goto(`${w.url}/map/root`);
  const real = p.locator('[data-tile="payments"]');
  await expect(real).toHaveAttribute("data-proposed", "false");
  expect(await real.evaluate((e) => getComputedStyle(e).borderTopStyle)).toBe("solid");
});

test("[70.2] the person accepts one ghost with the ✓ button and it becomes real", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "payments", "root", { title: "Payments" }));
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  await p.goto(`${w.url}/map/refunds`);
  const n = logOf(w).length;
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
  await expect(p.getByRole("button", { name: "Accept" })).toHaveCount(0);
  const ev = logOf(w).slice(n);
  expect(ev.length).toBe(1);
  expect(ev[0]).toMatchObject({ type: "change.accepted", actor: "you", payload: { id: "refunds" } });
  await p.goto(`${w.url}/map/payments`);
  await expect(p.locator('[data-tile="refunds"]')).toHaveAttribute("data-proposed", "false");
});

test("[70.3] accepting a ghost child under a ghost parent makes both real", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "payments", "root", { title: "Payments" }));
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  w.werk("add", "partial", "--title", "Partial refunds", "--parent", "refunds");
  await p.goto(`${w.url}/map/partial`);
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
  await p.goto(`${w.url}/map/refunds`);
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
  await expect(p.locator('[data-tile="partial"]')).toHaveAttribute("data-proposed", "false");
  await p.goto(`${w.url}/map/payments`);
  await expect(p.locator('[data-tile="refunds"]')).toHaveAttribute("data-proposed", "false");
});

test("[70.4] an accept takes only the accepted card's branch, not other ghosts", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "payments", "root", { title: "Payments" }));
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  w.werk("add", "chargebacks", "--title", "Chargebacks", "--parent", "payments");
  w.werk("add", "refunds:opt0", "--kind", "option", "--title", "Credit notes", "--why_not", "slow");
  w.werk("link", "refunds:opt0", "refunds", "--type", "alternative_to");
  w.werk("add", "refunds:src0", "--kind", "source", "--title", "Survey", "--finding", "found");
  w.werk("link", "refunds", "refunds:src0", "--type", "supported_by");
  await p.goto(`${w.url}/map/refunds`);
  await p.getByRole("button", { name: "Accept" }).click();
  await expect(p.locator("article")).toHaveAttribute("data-proposed", "false");
  await expect(p.locator('[data-section="options"]')).not.toContainText("proposed");
  await expect(p.locator('[data-section="evidence"]')).not.toContainText("proposed");
  await p.goto(`${w.url}/map/payments`);
  await expect(p.locator('[data-tile="chargebacks"]')).toHaveAttribute("data-proposed", "true");
  await expect(p.getByRole("button", { name: /accept (all|both|every)/i })).toHaveCount(0);
});

test("[70.5] a second view sees the accept because it reads the same log", async ({ browser }) => {
  const w = await project(undefined, (d) => card(d, "payments", "root", { title: "Payments" }));
  w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await a.goto(`${w.url}/map/payments`);
  await b.goto(`${w.url}/map/payments`);
  await expect(a.locator('[data-tile="refunds"]')).toHaveAttribute("data-proposed", "true");
  await expect(b.locator('[data-tile="refunds"]')).toHaveAttribute("data-proposed", "true");
  await a.goto(`${w.url}/map/refunds`);
  await a.getByRole("button", { name: "Accept" }).click();
  await expect(b.locator('[data-tile="refunds"]')).toHaveAttribute("data-proposed", "false");
});

// ---------- 72
function chain(d: Pick<Werk, "seed">, ids: string[], decided = true) {
  for (const id of ids) card(d, id, "root", { title: `Card ${id}`, ...(decided ? {} : { status: "open" }) });
  for (const id of ids) full(d, id);
}
const dep = (d: Pick<Werk, "seed">, from: string, to: string) => d.seed("edge.added", { from, to, type: "depends_on", why: `${from} takes ${to}` });

test("[72.1] a rejected reopen marks only the direct dependent as stale, in red", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    chain(d, ["a", "b", "c"]);
    dep(d, "b", "a");
    dep(d, "c", "b");
  });
  w.werk("reopen", "a", "--reason", "rejected", "--why", "the storage choice is wrong");
  await p.goto(`${w.url}/map/root`);
  const b = p.locator('[data-tile="b"]');
  const c = p.locator('[data-tile="c"]');
  await expect(b).toHaveAttribute("data-stale", "true");
  expect(isRed(await rgb(b, "backgroundColor"))).toBe(true);
  await expect(b).toHaveAttribute("data-status", "decided");
  await expect(c).toHaveAttribute("data-stale", "false");
  await expect(c).toHaveAttribute("data-postponed", "false");
});

test("[72.2] a postponed reopen marks every downstream card as paused, in grey, and keeps the status", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    chain(d, ["a", "b", "c"]);
    dep(d, "b", "a");
    dep(d, "c", "b");
  });
  w.werk("reopen", "a", "--reason", "postponed", "--why", "later");
  await p.goto(`${w.url}/map/root`);
  for (const id of ["b", "c"]) {
    const t = p.locator(`[data-tile="${id}"]`);
    await expect(t).toHaveAttribute("data-status", "decided");
    await expect(t).toHaveAttribute("data-stale", "false");
    await expect(t.locator('[data-tag="paused"]')).toBeVisible({ timeout: 2000 });
  }
});

test("[72.3] the card view of a stale card explains the change, the link, and the reason", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    chain(d, ["a", "b"]);
    dep(d, "b", "a");
  });
  w.werk("reopen", "a", "--reason", "rejected", "--why", "The vendor dropped this API");
  await p.goto(`${w.url}/map/b`);
  const s = p.locator('[data-section="stale"]');
  await expect(s.locator("h2")).toHaveText("Why this card is stale");
  await expect(s).toContainText("#a");
  await expect(s).toContainText("rejected");
  await expect(s).toContainText("The vendor dropped this API");
  await expect(s).toContainText(/b/);
  await expect(s).toContainText("depends_on");
});

test("[72.4] the card view of a paused card two hops away names the reopened card and the reason", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    chain(d, ["a", "b", "c"]);
    dep(d, "b", "a");
    dep(d, "c", "b");
  });
  w.werk("reopen", "a", "--reason", "postponed", "--why", "We build the engine next quarter");
  await p.goto(`${w.url}/map/c`);
  const s = p.locator('[data-section="stale"]');
  await expect(s.locator("h2")).toHaveText("Why this card is stale");
  await expect(s).toContainText("#a");
  await expect(s).toContainText("postponed");
  await expect(s).toContainText("We build the engine next quarter");
});

test("[72.5] a stale mark wins over a paused mark on the same card", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    chain(d, ["a", "x", "b"]);
    dep(d, "b", "a");
    dep(d, "b", "x");
  });
  w.werk("reopen", "x", "--reason", "postponed");
  w.werk("reopen", "a", "--reason", "rejected", "--why", "bad");
  await p.goto(`${w.url}/map/root`);
  const b = p.locator('[data-tile="b"]');
  await expect(b).toHaveAttribute("data-stale", "true");
  await expect(b).toHaveAttribute("data-postponed", "false");
  await p.goto(`${w.url}/map/b`);
  const s = p.locator('[data-section="stale"]');
  await expect(s).toContainText("#a");
  await expect(s).toContainText("rejected");
});
