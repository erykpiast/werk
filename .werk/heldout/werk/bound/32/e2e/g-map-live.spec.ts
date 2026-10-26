import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { type MapServer, open, ROOT, startMapServer } from "./support-map.ts";

const markLoaded = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { loaded: boolean }).loaded = true;
  });
const stillLoaded = (page: Page) =>
  page
    .evaluate(() => (window as unknown as { loaded?: boolean }).loaded === true)
    .catch(() => false);
const leftPane = (page: Page) => page.getByRole("region", { name: "Map pane" });

let server: MapServer;
test.afterEach(async () => {
  await server?.dispose();
});

function listenerPids(port: number): string[] {
  try {
    return execFileSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

test("14.1 a card added from the command line appears on the open page, with no reload and the draft kept", async ({
  page,
}) => {
  server = await startMapServer({ log: [ROOT] });
  await server.start();
  await page.goto(server.url);
  await expect(
    leftPane(page).getByRole("heading", { level: 1, name: "Root" }),
  ).toBeVisible();
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill("half a thought");
  await markLoaded(page);

  const added = server.werk(
    "add",
    "fresh",
    "--title",
    "Fresh idea",
    "--parent",
    "root",
  );
  expect(added.code).toBe(0);

  await expect(leftPane(page).getByText("Fresh idea")).toBeVisible();
  expect(await stillLoaded(page)).toBe(true);
  await expect(composer).toHaveValue("half a thought");
});

test("14.2 in dev a server edit changes a response and the live page stays connected", async ({
  page,
}) => {
  server = await startMapServer({
    log: [ROOT, open("pinned", { parent: "root", title: "Pinned card" })],
    appCopy: true,
  });
  await server.start();
  await page.goto(`${server.url}/map/pinned`);
  await expect(
    leftPane(page).getByRole("heading", { level: 1, name: "Pinned card" }),
  ).toBeVisible();
  await markLoaded(page);

  const pidBefore = server.pid();
  const listenersBefore = listenerPids(server.port);
  expect(pidBefore).toBeDefined();
  expect(listenersBefore).toEqual([String(pidBefore)]);
  const before = await (await fetch(`${server.origin}/api/projects`)).json();
  expect(before.edited).toBeUndefined();

  const routes = join(server.appDir, "src", "serve", "routes.ts");
  const text = readFileSync(routes, "utf8");
  const needle = "return json({ projects: entries(ctx.projects) });";
  expect(text).toContain(needle);
  writeFileSync(
    routes,
    text.replace(
      needle,
      "return json({ projects: entries(ctx.projects), edited: true });",
    ),
  );

  await expect
    .poll(() => server.output(), { timeout: 20000 })
    .toMatch(/hot reload: reusing the live server/);
  await expect
    .poll(
      async () =>
        (await (await fetch(`${server.origin}/api/projects`)).json()).edited,
      { timeout: 20000 },
    )
    .toBe(true);
  expect(listenerPids(server.port)).toEqual([String(pidBefore)]);
  expect(server.pid()).toBe(pidBefore);
  expect(server.output()).toContain(`on port ${server.port}`);

  expect(
    server.werk("add", "after", "--title", "After edit", "--parent", "pinned")
      .code,
  ).toBe(0);
  await expect(page.getByText("After edit").first()).toBeVisible();
  expect(await stillLoaded(page)).toBe(true);
});

test("14.3 in dev a client edit that cannot apply in place reloads the page and keeps the draft", async ({
  page,
}) => {
  server = await startMapServer({
    log: [ROOT, open("pinned", { parent: "root", title: "Pinned card" })],
    appCopy: true,
  });
  await server.start();
  await page.goto(`${server.url}/map/pinned`);
  const title = leftPane(page).getByRole("heading", {
    level: 1,
    name: "Pinned card",
  });
  await expect(title).toBeVisible();
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill("draft that must survive");
  await markLoaded(page);

  // The entry file is no component, so Vite cannot swap it in place.
  const entry = join(server.appDir, "client", "main.tsx");
  writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// edited\n`);

  await expect.poll(() => stillLoaded(page), { timeout: 20000 }).toBe(false);
  await expect(title).toBeVisible();
  await expect(composer).toHaveValue("draft that must survive");
});
