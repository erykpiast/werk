import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";
import { fixtureCopy, serve } from "./f5-serve.ts";

test.afterEach(stop);
const card = (w: Pick<Werk, "seed">, id: string, parent: string, title = id) =>
  w.seed("node.added", { id, kind: "card", title, parent, status: "decided", who: "me" });

test("69.1 map shows refines tree", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    card(d, "c1", "root", "Child one");
    card(d, "c2", "root", "Child two");
    card(d, "g1", "c1", "Grandchild");
  });
  await p.goto(`${w.url}/map`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Root");
  await expect(p.locator("[data-tile]")).toHaveCount(2);
  await expect(p.locator('a[data-tile="c1"]')).toContainText("Child one");
  await expect(p.locator('a[data-tile="c2"]')).toContainText("Child two");
  await expect(p.locator('a[data-tile="g1"]')).toHaveCount(0);
  await expect(p.locator("body")).not.toContainText("Grandchild");
  await p.locator('a[data-tile="c1"]').click();
  await expect(p.locator('a[data-tile="g1"]')).toContainText("Grandchild");
});

test("69.2 card added and accepted from CLI appears without reload", async ({ page: p }) => {
  const w = await project();
  await p.goto(`${w.url}/map`);
  await expect(p.locator("body")).not.toContainText("Use an append-only log");
  await p.evaluate(() => { (window as any).kept = true; });
  w.werk("add", "log", "--title", "Use an append-only log", "--parent", "root");
  w.werk("accept", "log", "--actor", "you");
  await expect(p.locator('a[data-tile="log"]')).toContainText("Use an append-only log", { timeout: 5000 });
  await expect(p.locator('a[data-tile="log"]')).toHaveAttribute("data-proposed", "false");
  expect(await p.evaluate(() => (window as any).kept === true)).toBe(true);
});

test("69.3 open card survives reload; no control edits its text", async ({ page: p }) => {
  const w = await project(undefined, (d) => card(d, "c1", "root", "Child one"));
  await p.goto(`${w.url}/map`);
  await p.locator('a[data-tile="c1"]').click();
  await expect(p).toHaveURL(/\/map\/c1$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Child one");
  const art = p.locator("article");
  await expect(art.locator("input, textarea, [contenteditable=true]")).toHaveCount(0);
  const buttons = await art.getByRole("button").allTextContents();
  const names = await art.getByRole("button").evaluateAll((bs) => bs.map((b) => `${b.textContent} ${b.getAttribute("aria-label")} ${b.getAttribute("title")}`));
  for (const n of names) expect(n).not.toMatch(/edit|save|rename|retitle/i);
  void buttons;
  // the only text box on the page outside the chat is the note box; it does not change title or body
  const boxes = await p.locator('#view textarea, #view input[type=text], #view [role=textbox]').evaluateAll((e) => e.map((x) => x.getAttribute("aria-label")));
  for (const b of boxes) expect(b).toBe("Note");
  await p.reload();
  await expect(p).toHaveURL(/\/map\/c1$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Child one");
});

test("69.4 second server waits then refuses", async ({ page: p }) => {
  const dir = fixtureCopy();
  const a = serve(dir);
  const url = await a.url();
  const b = serve(dir);
  const t0 = Date.now();
  await new Promise((r) => setTimeout(r, 1500));
  const early = b.out() + b.err();
  const code = await Promise.race([b.exited, new Promise((r) => setTimeout(() => r("timeout"), 15000))]);
  const secs = (Date.now() - t0) / 1000;
  expect(code).not.toBe("timeout");
  expect(secs).toBeLessThan(7);
  expect(b.err()).toContain(`pid ${a.proc.pid}`);
  // the second server prints that it waits for the first server's process id (while it waits)
  expect(early).toMatch(/wait/i);
  expect(early).toContain(String(a.proc.pid));
  await p.goto(`${url}/map`);
  await expect(p.locator("[data-tile]")).toHaveCount(2);
  a.proc.kill();
});
