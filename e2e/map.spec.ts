import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./support/fixtures.ts";
import { startBrowserServer } from "./support/server.ts";

const ROOT_TITLE = "We build software with agents";

/** A value that a reload erases: it proves that the page did not reload. */
const markLoaded = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    (window as unknown as { loaded: boolean }).loaded = true;
  });
const stillLoaded = (page: import("@playwright/test").Page) =>
  page.evaluate(
    () => (window as unknown as { loaded?: boolean }).loaded === true,
  );

const leftPane = (page: import("@playwright/test").Page) =>
  page.getByRole("region", { name: "Map pane" });

test("the left pane opens the title of the root card", async ({
  page,
  app,
  evidence,
}) => {
  await page.goto(app.url);
  await expect(
    leftPane(page).getByRole("heading", { level: 1, name: ROOT_TITLE }),
  ).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Chat pane" }),
  ).toBeVisible();
  await evidence(page, "root-card");
});

test("a card added from the command line appears with no reload", async ({
  page,
  app,
  evidence,
}) => {
  await page.goto(app.url);
  await expect(leftPane(page).getByRole("heading", { level: 1 })).toBeVisible();
  await markLoaded(page);

  const added = app.werk(
    "add",
    "seats",
    "--title",
    "We charge per seat",
    "--parent",
    "root",
  );
  expect(added.code).toBe(0);

  await expect(leftPane(page).getByText("We charge per seat")).toBeVisible();
  expect(await stillLoaded(page)).toBe(true);
  await evidence(page, "card-added");
});

test("a card added while the server was stopped shows after the page reconnects", async ({
  page,
  app,
}) => {
  await page.goto(app.url);
  await expect(leftPane(page).getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("live", { exact: true })).toBeVisible();

  await app.stop();
  expect(
    app.werk(
      "add",
      "invoice",
      "--title",
      "The invoice shows the seat count",
      "--parent",
      "root",
    ).code,
  ).toBe(0);
  await app.start();

  await expect(
    leftPane(page).getByText("The invoice shows the seat count"),
  ).toBeVisible({ timeout: 20000 });
});

test("a client edit that cannot apply in place reloads the page and keeps the draft", async ({
  page,
  appCopy,
}) => {
  await page.goto(appCopy.url);
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill("a draft that must survive");
  await markLoaded(page);

  // The entry file is no component, so Vite cannot swap it in place.
  const entry = join(appCopy.appDir, "client", "main.tsx");
  writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// edited\n`);

  await expect.poll(() => stillLoaded(page), { timeout: 20000 }).toBe(false);
  await expect(composer).toHaveValue("a draft that must survive");
});

test("a client edit that can apply in place keeps the page and the draft", async ({
  page,
  appCopy,
}) => {
  await page.goto(appCopy.url);
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill("typed before the edit");
  await expect(leftPane(page).getByRole("heading", { level: 1 })).toBeVisible();
  await markLoaded(page);

  const view = join(appCopy.appDir, "client", "app", "map-view.tsx");
  writeFileSync(
    view,
    readFileSync(view, "utf8").replace(
      "{map.open.title}</h1>",
      "{map.open.title} (edited)</h1>",
    ),
  );

  await expect(
    leftPane(page).getByRole("heading", { level: 1, name: /\(edited\)/ }),
  ).toBeVisible({ timeout: 20000 });
  expect(await stillLoaded(page)).toBe(true);
  await expect(composer).toHaveValue("typed before the edit");
});

test("the browser server refuses to start when the fake agent is not first", async () => {
  await expect(
    startBrowserServer({ env: { PATH: "/usr/bin:/bin" } }),
  ).rejects.toThrow(/fake agent is not first/);
});
