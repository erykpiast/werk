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
/** A page that is navigating has lost its marker, so a destroyed context counts as a reload. */
const stillLoaded = (page: import("@playwright/test").Page) =>
  page
    .evaluate(() => (window as unknown as { loaded?: boolean }).loaded === true)
    .catch(() => false);

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

test("the root page lists real sub-cards as tiles before ghosts, and a tile opens its card's page", async ({
  page,
  app,
  evidence,
}) => {
  const add = (id: string, title: string) =>
    expect(app.werk("add", id, "--title", title, "--parent", "root").code).toBe(
      0,
    );
  add("ghost", "A ghost card");
  add("real", "A real card");
  expect(app.werk("accept", "real", "--actor", "you").code).toBe(0);

  await page.goto(app.url);
  const tiles = leftPane(page).locator("a.tile");
  await expect(tiles).toHaveCount(2);
  await expect(tiles.nth(0)).toContainText("A real card");
  await expect(tiles.nth(1)).toContainText("A ghost card");
  await expect(
    leftPane(page).getByText("this card and everything below it, 2 cards"),
  ).toBeVisible();
  await evidence(page, "root-tiles");

  await tiles.nth(0).click();
  await expect(
    leftPane(page).getByRole("heading", { level: 1, name: "A real card" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/map\/real$/);
  await page.goBack();
  await expect(
    leftPane(page).getByRole("heading", { level: 1, name: ROOT_TITLE }),
  ).toBeVisible();
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

  const composerFile = join(appCopy.appDir, "client", "app", "composer.tsx");
  writeFileSync(
    composerFile,
    readFileSync(composerFile, "utf8").replace(
      "Message the agent",
      "Message the agent (edited)",
    ),
  );

  await expect(page.getByPlaceholder("Message the agent (edited)")).toBeVisible(
    { timeout: 20000 },
  );
  expect(await stillLoaded(page)).toBe(true);
  await expect(composer).toHaveValue("typed before the edit");
});

test("the browser server refuses to start when the fake agent is not first", async () => {
  await expect(
    startBrowserServer({ env: { PATH: "/usr/bin:/bin" } }),
  ).rejects.toThrow(/fake agent is not first/);
});
