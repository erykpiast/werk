import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { type Dev, startDev } from "./server.ts";

const markLoaded = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { loaded: boolean }).loaded = true;
  });
const stillLoaded = (page: Page) =>
  page
    .evaluate(() => (window as unknown as { loaded?: boolean }).loaded === true)
    .catch(() => false);
const pane = (page: Page) => page.getByRole("region", { name: "Map pane" });

let dev: Dev;
test.beforeEach(async () => {
  dev = await startDev();
});
test.afterEach(async () => {
  await dev.dispose();
});

test("14.1 a card added from the command line appears with no reload and the draft stays", async ({
  page,
}) => {
  await page.goto(dev.url);
  await expect(pane(page).getByRole("heading", { level: 1 })).toBeVisible();
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill("half a thought");
  await markLoaded(page);
  const added = dev.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
  expect(added.status).toBe(0);
  await expect(pane(page).getByText("Fresh idea")).toBeVisible();
  expect(await stillLoaded(page)).toBe(true);
  await expect(composer).toHaveValue("half a thought");
});

test("14.2 a server edit changes the response, reuses the live server, and the live channel stays", async ({
  page,
}) => {
  await page.goto(dev.url);
  await expect(pane(page).getByRole("heading", { level: 1 })).toBeVisible();
  await markLoaded(page);
  const pid = dev.pidOnPort();
  expect(pid).not.toBe("");
  const before = await fetch(`${dev.origin}/api/nothing-here`);
  expect(await before.json()).toEqual({ error: "not found" });

  const routes = join(dev.appDir, "src", "serve", "routes.ts");
  const src = readFileSync(routes, "utf8");
  const edited = src.replace(
    'return json({ error: "not found" }, 404);\n  };\n}',
    'return json({ error: "edited response" }, 404);\n  };\n}',
  );
  expect(edited).not.toBe(src);
  writeFileSync(routes, edited);

  await expect
    .poll(() => dev.state.output, { timeout: 20000 })
    .toContain("reusing the live server");
  expect(dev.pidOnPort()).toBe(pid);
  await expect
    .poll(
      async () =>
        (await (await fetch(`${dev.origin}/api/nothing-here`)).json()).error,
      { timeout: 20000 },
    )
    .toBe("edited response");
  expect(dev.state.output).toContain(`port ${dev.port}`);

  const added = dev.werk("add", "after", "--title", "After edit", "--parent", "root");
  expect(added.status).toBe(0);
  await expect(pane(page).getByText("After edit")).toBeVisible({ timeout: 20000 });
  expect(await stillLoaded(page)).toBe(true);
});

test("14.3 a client edit that cannot apply in place reloads the page and keeps the draft", async ({
  page,
}) => {
  await page.goto(dev.url);
  const title = pane(page).getByRole("heading", { level: 1 });
  await expect(title).toBeVisible();
  const titleText = await title.innerText();
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill("draft that must survive");
  await markLoaded(page);

  const entry = join(dev.appDir, "client", "main.tsx");
  writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// edited\n`);

  await expect.poll(() => stillLoaded(page), { timeout: 20000 }).toBe(false);
  await expect(pane(page).getByRole("heading", { level: 1 })).toHaveText(titleText);
  await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue(
    "draft that must survive",
  );
});
