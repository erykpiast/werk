import { expect, leftPane, test } from "./support.ts";

const ROOT_TITLE = "We build software with agents";

function seedDeep(s: import("./support.ts").BrowserServer) {
  const add = (id: string, parent: string) =>
    expect(
      s.werk("add", id, "--title", `Level ${id}`, "--parent", parent).code,
    ).toBe(0);
  add("a", "root");
  add("b", "a");
  add("c", "b");
  add("d", "c");
  for (const id of ["a", "b", "c", "d"])
    expect(s.werk("accept", id, "--actor", "you").code).toBe(0);
}

test("17.1 a person opens a deep card and follows the breadcrumbs back", async ({
  page,
  make,
}) => {
  const s = await make({ seed: seedDeep });
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto(s.url);
  await page.getByRole("navigation", { name: "Views" }).getByRole("button", { name: "Home" }).click();
  // Given: the left pane is narrower than 700px
  const width = await leftPane(page).evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBeLessThan(700);
  await page.getByRole("navigation", { name: "Views" }).getByRole("button", { name: "Map" }).click();
  for (const id of ["a", "b", "c", "d"]) {
    await leftPane(page).locator("a.tile", { hasText: `Level ${id}` }).click();
    await expect(page).toHaveURL(new RegExp(`/map/${id}$`));
  }
  const crumbs = page.getByRole("navigation", { name: "Breadcrumbs" });
  const line = crumbs.locator("[data-slot=crumb-line]");
  await expect(line).toHaveText(/^\s*…\s*›\s*Level c\s*›\s*Level d\s*$/);
  await expect(line.locator("strong")).toHaveText("Level d");
  await expect(line.getByRole("button")).toHaveText(["Level c"]);
  expect((await line.boundingBox())?.height).toBeLessThan(40);

  await line.hover({ force: true });
  const overlay = crumbs.locator("[data-slot=crumb-overlay]");
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText(ROOT_TITLE);
  for (const id of ["a", "b", "c", "d"]) await expect(overlay).toContainText(`Level ${id}`);

  await overlay.getByRole("button", { name: "Level c" }).click();
  await expect(page).toHaveURL(/\/map\/c$/);
  await expect(leftPane(page).getByRole("heading", { level: 1, name: "Level c" })).toBeVisible();
  await expect(crumbs.locator("[data-slot=crumb-line] strong")).toHaveText("Level c");
});
