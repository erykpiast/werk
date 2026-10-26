import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { composer, leftPane, markLoaded, stillLoaded, withServer } from "./support.ts";

test("14.1 a card added from the command line shows without a reload and keeps the draft", async ({ page }) => {
  await withServer({}, async (s) => {
    await page.goto(s.url);
    await expect(leftPane(page).getByRole("heading", { level: 1, name: "We build software with agents" })).toBeVisible();
    await composer(page).fill("half a thought");
    await markLoaded(page);
    s.ok("add", "fresh", "--title", "Fresh idea", "--parent", "root");
    await expect(leftPane(page).getByText("Fresh idea")).toBeVisible();
    expect(await stillLoaded(page)).toBe(true);
    await expect(composer(page)).toHaveValue("half a thought");
  });
});

test("14.2 a server edit changes a response, reuses the live server, and the live channel stays", async ({ page }) => {
  await withServer({ appCopy: true }, async (s) => {
    await page.goto(s.url);
    await expect(leftPane(page).getByRole("heading", { level: 1 })).toBeVisible();
    await markLoaded(page);
    const pidBefore = s.pid;
    const before = await (await fetch(`${s.origin}/api/projects`)).json();
    expect(before.heldOutEdit).toBeUndefined();

    const routes = join(s.appDir, "src", "serve", "routes.ts");
    const src = readFileSync(routes, "utf8");
    const needle = "return json({ projects: entries(ctx.projects) });";
    expect(src).toContain(needle);
    writeFileSync(routes, src.replace(needle, 'return json({ projects: entries(ctx.projects), heldOutEdit: "edited" });'));

    await expect
      .poll(async () => (await (await fetch(`${s.origin}/api/projects`)).json()).heldOutEdit, { timeout: 20000 })
      .toBe("edited");
    expect(s.output).toContain("reusing the live server");
    expect(s.alive()).toBe(true);
    expect(s.pid).toBe(pidBefore);

    s.ok("add", "after", "--title", "After edit", "--parent", "root");
    await expect(leftPane(page).getByText("After edit")).toBeVisible({ timeout: 20000 });
    expect(await stillLoaded(page)).toBe(true);
  });
});

test("14.3 a client edit that cannot apply in place reloads the page and keeps the draft", async ({ page }) => {
  await withServer({ appCopy: true }, async (s) => {
    await page.goto(s.url);
    const h1 = leftPane(page).getByRole("heading", { level: 1 });
    await expect(h1).toBeVisible();
    const title = await h1.innerText();
    await composer(page).fill("draft that must survive");
    await markLoaded(page);
    const entry = join(s.appDir, "client", "main.tsx");
    writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// edited\n`);
    await expect.poll(() => stillLoaded(page), { timeout: 20000 }).toBe(false);
    await expect(leftPane(page).getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(composer(page)).toHaveValue("draft that must survive");
  });
});
