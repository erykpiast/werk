import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chat, composer, expect, leftPane, markLoaded, ROOT_TITLE, serve, stillLoaded, test } from "./browser-support.ts";

test("14.1 CLI add appears without reload, draft kept", async ({ page }) => {
  const s = await serve();
  try {
    await page.goto(s.url);
    await expect(leftPane(page).getByRole("heading", { level: 1, name: ROOT_TITLE })).toBeVisible();
    await composer(page).fill("half a thought");
    await markLoaded(page);
    expect(s.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root").code).toBe(0);
    await expect(leftPane(page).getByText("Fresh idea")).toBeVisible();
    expect(await stillLoaded(page)).toBe(true);
    await expect(composer(page)).toHaveValue("half a thought");
  } finally {
    await s.dispose();
  }
});

test("14.2 server edit: reuse live server, same pid/port, edited response, live channel kept", async ({ page }) => {
  const s = await serve({ appCopy: true });
  try {
    await page.goto(s.url);
    await expect(leftPane(page).getByRole("heading", { level: 1 })).toBeVisible();
    await markLoaded(page);
    const pid = s.pid();
    const routes = join(s.appDir, "src", "serve", "routes.ts");
    const before = await fetch(`${s.origin}/api/nothing-here`);
    expect(before.status).toBe(404);
    const src = readFileSync(routes, "utf8");
    expect(src).toContain('return json({ error: "not found" }, 404);');
    const last = src.lastIndexOf('return json({ error: "not found" }, 404);');
    writeFileSync(
      routes,
      `${src.slice(0, last)}return json({ error: "edited-response" }, 404);${src.slice(last + 'return json({ error: "not found" }, 404);'.length)}`,
    );
    await expect.poll(() => s.output(), { timeout: 20000 }).toMatch(/reusing the live server/);
    expect(s.pid()).toBe(pid);
    await expect
      .poll(async () => (await (await fetch(`${s.origin}/api/nothing-here`)).text()), { timeout: 20000 })
      .toContain("edited-response");
    expect(s.werk("add", "after", "--title", "After edit", "--parent", "root").code).toBe(0);
    await expect(leftPane(page).getByText("After edit")).toBeVisible({ timeout: 15000 });
    expect(await stillLoaded(page)).toBe(true);
  } finally {
    await s.dispose();
  }
});

test("14.3 client edit that cannot apply reloads, keeps title and draft", async ({ page }) => {
  const s = await serve({ appCopy: true });
  try {
    await page.goto(s.url);
    const h1 = leftPane(page).getByRole("heading", { level: 1 });
    await expect(h1).toHaveText(ROOT_TITLE);
    await composer(page).fill("draft that must survive");
    await markLoaded(page);
    const entry = join(s.appDir, "client", "main.tsx");
    writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// edited\n`);
    await expect.poll(() => stillLoaded(page), { timeout: 20000 }).toBe(false);
    await expect(h1).toHaveText(ROOT_TITLE);
    await expect(composer(page)).toHaveValue("draft that must survive");
    void chat;
  } finally {
    await s.dispose();
  }
});
