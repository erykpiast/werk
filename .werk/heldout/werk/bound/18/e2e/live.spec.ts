import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { card } from "../events.ts";
import { startServer } from "./server.ts";

const markLoaded = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { loaded: boolean }).loaded = true;
  });
const stillLoaded = (page: Page) =>
  page
    .evaluate(() => (window as unknown as { loaded?: boolean }).loaded === true)
    .catch(() => false);
const pane = (page: Page) => page.getByRole("region", { name: "Map pane" });
const composer = (page: Page) => page.getByRole("textbox", { name: "Message" });

test("14.1 a card added from the command line appears on the open page without a reload", async ({
  page,
}) => {
  const server = await startServer({ events: card("root", { title: "Root" }) });
  await server.start();
  try {
    await page.goto(server.url);
    await expect(pane(page).getByRole("heading", { level: 1, name: "Root" })).toBeVisible();
    await composer(page).fill("half a thought");
    await markLoaded(page);
    const added = server.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
    expect(added.code, added.stderr).toBe(0);
    await expect(pane(page).getByText("Fresh idea")).toBeVisible();
    expect(await stillLoaded(page)).toBe(true);
    await expect(composer(page)).toHaveValue("half a thought");
  } finally {
    await server.dispose();
  }
});

test("14.2 in dev, a server edit changes a response and the live page stays connected", async ({
  page,
}) => {
  const server = await startServer({
    events: card("root", { title: "Root" }),
    appCopy: true,
  });
  await server.start();
  try {
    await page.goto(server.url);
    await expect(pane(page).getByRole("heading", { level: 1, name: "Root" })).toBeVisible();
    await markLoaded(page);
    const pidBefore = server.pid();
    const route = `${server.origin}/api/projects/project/graph`;
    const before = await (await fetch(route)).json();
    expect(before.error).toBe("the graph is read with shape=1");

    const file = join(server.appDir, "src", "serve", "routes.ts");
    const source = readFileSync(file, "utf8");
    expect(source).toContain("the graph is read with shape=1");
    writeFileSync(file, source.replace("the graph is read with shape=1", "edited by the person"));

    await expect
      .poll(() => server.output(), { timeout: 30_000 })
      .toContain("reusing the live server");
    expect(server.pid()).toBe(pidBefore);
    expect(server.alive()).toBe(true);
    expect(server.output()).toContain(`port ${server.port}`);
    const after = await (await fetch(route)).json();
    expect(after.error).toBe("edited by the person");

    const added = server.werk("add", "after", "--title", "After edit", "--parent", "root");
    expect(added.code, added.stderr).toBe(0);
    await expect(pane(page).getByText("After edit")).toBeVisible();
    expect(await stillLoaded(page)).toBe(true);
  } finally {
    await server.dispose();
  }
});

test("14.3 in dev, a client edit that cannot apply in place reloads the page and keeps the draft", async ({
  page,
}) => {
  const server = await startServer({
    events: card("root", { title: "Root" }),
    appCopy: true,
  });
  await server.start();
  try {
    await page.goto(server.url);
    await expect(pane(page).getByRole("heading", { level: 1, name: "Root" })).toBeVisible();
    await composer(page).fill("draft that must survive");
    await markLoaded(page);
    const file = join(server.appDir, "client", "main.tsx");
    writeFileSync(file, `${readFileSync(file, "utf8")}\nexport const editedByThePerson = 1;\n`);
    await expect.poll(() => stillLoaded(page), { timeout: 30_000 }).toBe(false);
    await expect(pane(page).getByRole("heading", { level: 1, name: "Root" })).toBeVisible();
    await expect(composer(page)).toHaveValue("draft that must survive");
  } finally {
    await server.dispose();
  }
});
