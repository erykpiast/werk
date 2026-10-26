import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { startBrowserServer } from "../e2e/support/server.ts";
import { composer, mapPane, startDevServer } from "./p7-support.ts";

const mark = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { loaded: boolean }).loaded = true;
  });
const stillLoaded = (page: Page) =>
  page
    .evaluate(() => (window as unknown as { loaded?: boolean }).loaded === true)
    .catch(() => false);

test("14.1 a card added from the command line appears on the open page without a reload", async ({
  page,
}) => {
  const server = await startBrowserServer();
  await server.start();
  try {
    await page.goto(server.url);
    await expect(
      mapPane(page).getByRole("heading", {
        level: 1,
        name: "We build software with agents",
      }),
    ).toBeVisible();
    await composer(page).fill("half a thought");
    await mark(page);
    const added = server.werk(
      "add",
      "fresh",
      "--title",
      "Fresh idea",
      "--parent",
      "root",
    );
    expect(added.code).toBe(0);
    await expect(mapPane(page).getByText("Fresh idea")).toBeVisible({
      timeout: 15000,
    });
    expect(await stillLoaded(page)).toBe(true);
    await expect(composer(page)).toHaveValue("half a thought");
  } finally {
    await server.dispose();
  }
});

test("14.2 in dev, a server edit changes a response and the live page stays connected", async ({
  page,
}) => {
  test.setTimeout(90000);
  const server = await startDevServer();
  try {
    await page.goto(server.url);
    await expect(mapPane(page).getByRole("heading", { level: 1 })).toBeVisible();
    await mark(page);
    const pid = /\(pid (\d+)\)/.exec(server.output())?.[1];
    expect(pid).toBeTruthy();
    const tabsUrl = `${server.origin}/api/projects/project/tabs`;
    const before = await (await fetch(tabsUrl)).json();
    expect(before.edited).toBeUndefined();

    const file = join(server.appDir, "src", "serve", "chat-route.ts");
    const source = readFileSync(file, "utf8");
    const needle = "Response.json({ tabs: [MAIN, ...others] })";
    expect(source).toContain(needle);
    writeFileSync(
      file,
      source.replace(needle, "Response.json({ tabs: [MAIN, ...others], edited: true })"),
    );

    await expect
      .poll(() => server.output(), { timeout: 20000 })
      .toContain("reusing the live server");
    await expect
      .poll(async () => (await (await fetch(tabsUrl)).json()).edited, {
        timeout: 20000,
      })
      .toBe(true);
    // The same process still runs, on the same port.
    expect(() => process.kill(Number(pid), 0)).not.toThrow();
    expect((await fetch(`${server.origin}/api/projects`)).ok).toBe(true);
    expect(server.output().match(/serving on/g)?.length).toBe(1);

    expect(
      server.werk("add", "after", "--title", "After edit", "--parent", "root")
        .code,
    ).toBe(0);
    await expect(mapPane(page).getByText("After edit")).toBeVisible({
      timeout: 15000,
    });
    expect(await stillLoaded(page)).toBe(true);
  } finally {
    await server.dispose();
  }
});

test("14.3 in dev, a client edit that cannot apply in place reloads the page and keeps the draft", async ({
  page,
}) => {
  test.setTimeout(90000);
  const server = await startDevServer();
  try {
    expect(
      server.werk("add", "seats", "--title", "We charge per seat", "--parent", "root").code,
    ).toBe(0);
    expect(server.werk("accept", "seats", "--actor", "you").code).toBe(0);
    await page.goto(`${server.url}/map/seats`);
    const title = mapPane(page).getByRole("heading", {
      level: 1,
      name: "We charge per seat",
    });
    await expect(title).toBeVisible();
    await composer(page).fill("draft that must survive");
    await mark(page);

    const entry = join(server.appDir, "client", "main.tsx");
    writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// edited\n`);

    await expect.poll(() => stillLoaded(page), { timeout: 20000 }).toBe(false);
    await expect(title).toBeVisible({ timeout: 15000 });
    await expect(composer(page)).toHaveValue("draft that must survive");
  } finally {
    await server.dispose();
  }
});
