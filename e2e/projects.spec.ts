import { join } from "node:path";
import { tokenOf } from "../src/serve/page-html.ts";
import { expect, test } from "./support/fixtures.ts";

const REPO = join(import.meta.dirname, "..");

type Listed = { name: string; folder: string; dev: boolean };

test("in dev mode the checkout is on the list after a restart and cannot be removed", async ({
  app,
}) => {
  const list = async () =>
    (
      (await (await fetch(`${app.origin}/api/projects`)).json()) as {
        projects: Listed[];
      }
    ).projects;
  const onList = async () => (await list()).find((p) => p.dev);

  expect(await onList()).toMatchObject({ folder: REPO });

  await app.stop();
  await app.start();
  const dev = await onList();
  expect(dev).toMatchObject({ folder: REPO });

  const token = tokenOf(await (await fetch(`${app.origin}/`)).text()) as string;
  const removed = await fetch(
    `${app.origin}/api/projects/${encodeURIComponent((dev as Listed).name)}`,
    { method: "DELETE", headers: { "x-werk-token": token } },
  );
  expect(removed.status).toBe(403);
  expect(await onList()).toBeDefined();
});

test("the page of a project opens its map, and an address with no project opens the first one", async ({
  page,
  app,
}) => {
  await page.goto(app.origin);
  await expect(page).toHaveURL(/\/p\//);
  await expect(page.getByRole("region", { name: "Map pane" })).toBeVisible();
});

test("the switcher shows the open project and ends its menu with Add project…", async ({
  page,
  app,
}) => {
  await page.goto(app.origin);
  await expect(page).toHaveURL(/\/p\//);
  const button = page.locator("[data-slot=switcher-button]");
  await expect(button).toContainText("▾");
  await button.click();
  await expect(
    page.locator("[data-slot=switcher-menu]").getByText("+ Add project…"),
  ).toBeVisible();
});
