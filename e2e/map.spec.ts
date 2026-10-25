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

/** The page address of the project that the app opened, with no view suffix. */
async function projectBase(page: import("@playwright/test").Page, url: string) {
  await page.goto(url);
  await expect(page).toHaveURL(/\/p\/[^/]+/);
  const here = new URL(page.url());
  return here.origin + here.pathname.replace(/\/(map|board).*$/, "");
}

test("an address with an unknown card id says the card is not in the map", async ({
  page,
  app,
}) => {
  const base = await projectBase(page, app.url);
  await page.goto(`${base}/map/nobody`);
  await expect(
    leftPane(page).getByText("The map has no card nobody."),
  ).toBeVisible();
});

test("on a deep card the breadcrumbs stay one line, and hover shows the whole path", async ({
  page,
  app,
  evidence,
}) => {
  const add = (id: string, parent: string) =>
    expect(
      app.werk("add", id, "--title", `Level ${id}`, "--parent", parent).code,
    ).toBe(0);
  add("a", "root");
  add("b", "a");
  add("c", "b");
  add("d", "c");
  expect(app.werk("accept", "d", "--actor", "you").code).toBe(0);

  const base = await projectBase(page, app.url);
  await page.goto(`${base}/map/d`);
  const crumbs = page.getByRole("navigation", { name: "Breadcrumbs" });
  await expect(
    crumbs.locator("[data-slot=crumb-line] [data-slot=crumb-current]"),
  ).toHaveText("Level d");
  const line = crumbs.locator("[data-slot=crumb-line]");
  const before = await line.boundingBox();
  expect(before?.height).toBeLessThan(40);
  await expect(line).toContainText("…");

  await line.hover({ force: true });
  const overlay = crumbs.locator("[data-slot=crumb-overlay]");
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText(ROOT_TITLE);
  await expect(overlay).toContainText("Level a");
  expect((await line.boundingBox())?.height).toBe(before?.height);
  await evidence(page, "breadcrumbs-overlay");

  await overlay.getByRole("button", { name: "Level b" }).click();
  await expect(page).toHaveURL(/\/map\/b$/);
});

test("typing a card's exact id with # and pressing Enter opens that card", async ({
  page,
  app,
  evidence,
}) => {
  expect(
    app.werk(
      "add",
      "seats",
      "--title",
      "We charge per seat",
      "--parent",
      "root",
    ).code,
  ).toBe(0);
  expect(app.werk("accept", "seats", "--actor", "you").code).toBe(0);
  await page.goto(app.url);
  const box = page.getByRole("searchbox", { name: "Search the map" });
  await box.fill("#seats");
  await expect(
    page.getByRole("list", { name: "Search results" }),
  ).toBeVisible();
  await evidence(page, "search-results");
  await box.press("Enter");
  await expect(page).toHaveURL(/\/map\/seats$/);
  await expect(
    leftPane(page).getByRole("heading", {
      level: 1,
      name: "We charge per seat",
    }),
  ).toBeVisible();
  await expect(box).toHaveValue("");

  await box.fill("qqq");
  await expect(page.getByRole("list", { name: "Search results" })).toHaveCount(
    0,
  );
  await box.fill("seat");
  await box.press("Escape");
  await expect(box).toHaveValue("");
});

test("the Board tab opens the board address and Back returns to the map", async ({
  page,
  app,
}) => {
  await page.goto(app.url);
  await expect(leftPane(page).getByRole("heading", { level: 1 })).toBeVisible();
  const views = page.getByRole("navigation", { name: "Views" });
  await views.getByRole("button", { name: "Board" }).click();
  await expect(page).toHaveURL(/\/board$/);
  await expect(views.getByRole("button", { name: "Board" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.goBack();
  await expect(page).toHaveURL(/\/p\/[^/]+$/);
  await expect(
    leftPane(page).getByRole("heading", { level: 1, name: ROOT_TITLE }),
  ).toBeVisible();
});

const accepted = (
  app: { werk: (...a: string[]) => { code: number } },
  id: string,
) => expect(app.werk("accept", id, "--actor", "you").code).toBe(0);

test("a ghost shows dashed with the badge proposed, and its ✓ makes it a normal card with no reload", async ({
  page,
  app,
  evidence,
}) => {
  expect(
    app.werk("add", "g", "--title", "A ghost card", "--parent", "root").code,
  ).toBe(0);
  await page.goto(`${app.url}/map/g`);
  const hero = leftPane(page).locator(".hero");
  await expect(hero).toHaveClass(/is-proposed/);
  await expect(hero.locator(".tag-proposed")).toHaveText("proposed");
  expect(await hero.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe(
    "dashed",
  );
  await evidence(page, "ghost-proposed");
  await markLoaded(page);
  await hero.getByRole("button", { name: "Accept the proposal" }).click();
  await expect(hero).not.toHaveClass(/is-proposed/);
  await expect(hero.locator(".tag-proposed")).toHaveCount(0);
  expect(await stillLoaded(page)).toBe(true);
});

test("a pending edit shows one card with its added and removed words marked", async ({
  page,
  app,
  evidence,
}) => {
  expect(
    app.werk(
      "propose",
      "root",
      "--why",
      "One repeating loop keeps the work in step.",
    ).code,
  ).toBe(0);
  await page.goto(app.url);
  const hero = leftPane(page).locator(".hero");
  await expect(hero.locator("ins.diff-add")).toHaveText("loop");
  await expect(hero.locator("del.diff-del")).toHaveText("pipeline");
  await expect(hero).toHaveClass(/has-edit/);
  await expect(hero).not.toHaveClass(/is-proposed/);
  await evidence(page, "pending-edit");
});

test("the ✕ on a card with two children offers both answers, and moving up keeps the children", async ({
  page,
  app,
  evidence,
}) => {
  for (const [id, parent] of [
    ["p", "root"],
    ["a", "p"],
    ["b", "p"],
  ] as const) {
    expect(
      app.werk("add", id, "--title", `Card ${id}`, "--parent", parent).code,
    ).toBe(0);
  }
  accepted(app, "a");
  accepted(app, "b");
  await page.goto(`${app.url}/map/p`);
  const hero = leftPane(page).locator(".hero");
  await hero.getByRole("button", { name: "Remove this card" }).click();
  const dialog = hero.getByRole("alertdialog");
  await expect(dialog).toContainText("3 cards leave the map");
  await expect(dialog).toContainText("2 children move up to");
  await evidence(page, "remove-confirm");
  await dialog.getByRole("button", { name: /move up/ }).click();
  await expect(
    leftPane(page).getByRole("heading", { level: 1, name: "Card p" }),
  ).toHaveCount(0);
  await page.goto(`${app.url}/map/root`);
  await expect(leftPane(page).locator("a.tile")).toHaveCount(2);
});

test("a proposed removal shows red, and its ✓ takes the card out", async ({
  page,
  app,
  evidence,
}) => {
  expect(
    app.werk("add", "c", "--title", "A doomed card", "--parent", "root").code,
  ).toBe(0);
  accepted(app, "c");
  expect(app.werk("remove", "c", "--propose").code).toBe(0);
  await page.goto(`${app.url}/map/c`);
  const hero = leftPane(page).locator(".hero");
  await expect(hero).toHaveClass(/is-removal/);
  await expect(
    hero.getByRole("button", { name: "Accept the proposal" }),
  ).toHaveClass(/is-removal/);
  await evidence(page, "removal-proposed");
  await hero.getByRole("button", { name: "Accept the proposal" }).click();
  await page.goto(`${app.url}/map/root`);
  await expect(leftPane(page).locator("a.tile")).toHaveCount(0);
});

test("a ✓ request without the token is refused", async ({ page, app }) => {
  expect(
    app.werk("add", "g", "--title", "A ghost card", "--parent", "root").code,
  ).toBe(0);
  const origin = new URL(app.url).origin;
  const name = new URL(app.url).pathname.split("/").pop();
  const res = await page.request.post(`${origin}/api/projects/${name}/accept`, {
    data: { card: "g" },
  });
  expect(res.status()).toBe(403);
  await page.goto(`${app.url}/map/g`);
  await expect(leftPane(page).locator(".hero")).toHaveClass(/is-proposed/);
});

test("the home shows the requirements and the build rules in two equal columns", async ({
  page,
  app,
  evidence,
}) => {
  const add = (id: string, title: string, parent: string, why = "") =>
    expect(
      app.werk("add", id, "--title", title, "--parent", parent, "--why", why)
        .code,
    ).toBe(0);
  add("req1", "A requirement", "root");
  expect(app.werk("accept", "req1", "--actor", "you").code).toBe(0);

  // With no build-rules card, the right column is the empty build-rules card.
  await page.goto(app.url);
  const what = page.locator("[data-slot=home-what]");
  const how = page.locator("[data-slot=home-how]");
  await expect(
    what.getByRole("heading", { level: 1, name: ROOT_TITLE }),
  ).toBeVisible();
  await expect(what.locator("a.tile")).toContainText("A requirement");
  await expect(
    how.getByRole("heading", { level: 2, name: "Build rules" }),
  ).toBeVisible();
  await expect(how.locator("a.tile")).toHaveCount(0);

  expect(
    app.werk("add", "how", "--title", "How it is built", "--parent", "root")
      .code,
  ).toBe(0);
  expect(app.werk("accept", "how", "--actor", "you").code).toBe(0);
  add("rule1", "A build rule", "how");
  expect(app.werk("accept", "rule1", "--actor", "you").code).toBe(0);
  await expect(
    how.getByRole("heading", { level: 1, name: "How it is built" }),
  ).toBeVisible();
  await expect(how.locator("a.tile")).toContainText("A build rule");
  const left = await what.boundingBox();
  const right = await how.boundingBox();
  expect(Math.abs((left?.width ?? 0) - (right?.width ?? 1))).toBeLessThan(2);
  await evidence(page, "home-two-columns");

  await how.locator("a.tile").click();
  await expect(page).toHaveURL(/\/map\/rule1$/);
  await page.goBack();
  await expect(what).toBeVisible();
});
