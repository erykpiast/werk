import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { ROOT_EVENTS, serveProject } from "./server.ts";

const mark = (page: Page) => page.evaluate(() => ((window as unknown as { loaded: boolean }).loaded = true));
const still = (page: Page) => page.evaluate(() => (window as unknown as { loaded?: boolean }).loaded === true);
const pane = (page: Page) => page.getByRole("region", { name: "Map pane" });
const composer = (page: Page) => page.getByRole("textbox", { name: "Message" });

test("14.1 a card added from the command line appears with no reload", async ({ page }) => {
  const s = await serveProject(ROOT_EVENTS);
  try {
    await page.goto(s.url);
    await expect(pane(page).getByRole("heading", { level: 1, name: "Root" })).toBeVisible();
    await composer(page).fill("half a thought");
    await mark(page);
    const r = s.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
    expect(r.code, r.stderr).toBe(0);
    await expect(pane(page).getByText("Fresh idea")).toBeVisible({ timeout: 20000 });
    expect(await still(page)).toBe(true);
    await expect(composer(page)).toHaveValue("half a thought");
  } finally {
    await s.dispose();
  }
});

test("14.2 a server edit changes a response and the live page stays connected", async ({ page }) => {
  const s = await serveProject(ROOT_EVENTS, true);
  try {
    await page.goto(s.url);
    await expect(pane(page).getByRole("heading", { level: 1, name: "Root" })).toBeVisible();
    await mark(page);
    const before = s.listener();
    expect(before).not.toBe("");
    const routes = join(s.appDir, "src", "serve", "routes.ts");
    const src = readFileSync(routes, "utf8");
    const anchor = 'if (url.pathname === "/") return ctx.client.page(ctx.token);';
    expect(src).toContain(anchor);
    writeFileSync(routes, src.replace(anchor, `if (url.pathname === "/api/heldout-ping") return json({ ping: "edited" });\n    ${anchor}`));
    await expect
      .poll(async () => (await fetch(`${s.url}/api/heldout-ping`)).status, { timeout: 20000 })
      .toBe(200);
    const res = await fetch(`${s.url}/api/heldout-ping`);
    expect(await res.json()).toEqual({ ping: "edited" });
    expect(s.output()).toContain("reusing the live server");
    expect(s.listener()).toBe(before);
    const r = s.werk("add", "after", "--title", "After edit", "--parent", "root");
    expect(r.code, r.stderr).toBe(0);
    await expect(pane(page).getByText("After edit")).toBeVisible({ timeout: 20000 });
    expect(await still(page)).toBe(true);
  } finally {
    await s.dispose();
  }
});

test("14.3 a client edit that cannot apply in place reloads and keeps the draft", async ({ page }) => {
  const s = await serveProject(ROOT_EVENTS, true);
  try {
    await page.goto(s.url);
    await expect(pane(page).getByRole("heading", { level: 1, name: "Root" })).toBeVisible();
    await composer(page).fill("draft that must survive");
    await mark(page);
    const entry = join(s.appDir, "client", "main.tsx");
    writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// edited\n`);
    await expect.poll(() => still(page), { timeout: 20000 }).toBe(false);
    await expect(pane(page).getByRole("heading", { level: 1, name: "Root" })).toBeVisible();
    await expect(composer(page)).toHaveValue("draft that must survive");
  } finally {
    await s.dispose();
  }
});

test("06.2 an accepted excerpt is shown under its card as supporting evidence", async ({ page }) => {
  const s = await serveProject([
    ...ROOT_EVENTS,
    { type: "node.edited", id: "root", who: "me", noBasis: "seed" },
    { type: "criterion.added", id: "root", form: "revisit" },
    { type: "node.decided", id: "root" },
    { type: "node.proposed", id: "say1", kind: "excerpt", title: "Sam", status: "open", body: "the words as spoken" },
    { type: "edge.added", from: "root", to: "say1", link: "supported_by" },
  ]);
  try {
    const before = s.werk("show", "say1");
    expect(before.stdout).toContain("proposed");
    const acc = s.werk("accept", "say1", "--actor", "you");
    expect(acc.code, acc.stderr).toBe(0);
    const ex = s.werk("show", "say1");
    expect(ex.stdout).not.toContain("proposed");
    const card = s.werk("show", "root");
    expect(card.stdout).toContain("supported_by");
    expect(card.stdout).not.toContain("[held]");
    await page.goto(s.url);
    await expect(pane(page).getByRole("heading", { level: 1, name: "Root" })).toBeVisible();
    await expect(pane(page).getByText("the words as spoken")).toBeVisible({ timeout: 5000 });
  } finally {
    await s.dispose();
  }
});
