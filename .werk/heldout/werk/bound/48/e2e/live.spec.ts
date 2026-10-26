import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { type Held, startHeld } from "./server.ts";

const markLoaded = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { loaded: boolean }).loaded = true;
  });
const stillLoaded = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { loaded?: boolean }).loaded === true,
  );
const leftPane = (page: Page) => page.getByRole("region", { name: "Map pane" });

let held: Held | undefined;
test.afterEach(async () => {
  await held?.dispose();
  held = undefined;
});

test("14.1 a card added from the command line appears with no reload and the draft stays", async ({
  page,
}) => {
  held = await startHeld({ appCopy: false });
  await page.goto(held.url);
  await expect(
    leftPane(page).getByRole("heading", { level: 1, name: "Root" }),
  ).toBeVisible();
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill("half a thought");
  await markLoaded(page);
  const added = held.werk(
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

test("14.2 a server edit changes the response, reuses the live server, and the live channel stays", async ({
  page,
}) => {
  held = await startHeld({ appCopy: true });
  const h = held;
  await page.goto(h.url);
  await expect(leftPane(page).getByRole("heading", { level: 1 })).toBeVisible();
  await markLoaded(page);
  const served = /serving on http:\/\/127\.0\.0\.1:(\d+) \(pid (\d+)\)/.exec(
    h.output(),
  );
  expect(served).not.toBeNull();
  const [, port, pid] = served as RegExpExecArray;
  const before = await (await fetch(`${h.url}/api/graph`)).json();
  expect(before.error).toBe("the graph is read with shape=1");

  const routes = join(h.appDir, "src", "serve", "routes.ts");
  const text = readFileSync(routes, "utf8");
  expect(text).toContain("the graph is read with shape=1");
  writeFileSync(
    routes,
    text.replace("the graph is read with shape=1", "edited response"),
  );

  await expect
    .poll(() => h.output(), { timeout: 20000 })
    .toContain("reusing the live server");
  await expect
    .poll(async () => (await (await fetch(`${h.url}/api/graph`)).json()).error, {
      timeout: 20000,
    })
    .toBe("edited response");
  expect(Number(port)).toBe(h.port);
  expect(() => process.kill(Number(pid), 0)).not.toThrow();
  const again = /serving on http:\/\/127\.0\.0\.1:(\d+) \(pid (\d+)\)/g;
  expect([...h.output().matchAll(again)]).toHaveLength(1);

  expect(h.werk("add", "after", "--title", "After edit", "--parent", "root").code).toBe(0);
  await expect(leftPane(page).getByText("After edit")).toBeVisible();
  expect(await stillLoaded(page)).toBe(true);
});

test("14.3 a client edit that cannot apply in place reloads the page and keeps the draft", async ({
  page,
}) => {
  held = await startHeld({ appCopy: true });
  const h = held;
  await page.goto(h.url);
  const title = leftPane(page).getByRole("heading", { level: 1 });
  await expect(title).toHaveText("Root");
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill("draft that must survive");
  await markLoaded(page);
  const entry = join(h.appDir, "client", "main.tsx");
  writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// edited\n`);
  await expect.poll(() => stillLoaded(page), { timeout: 20000 }).toBe(false);
  await expect(title).toHaveText("Root");
  await expect(composer).toHaveValue("draft that must survive");
});

test("06.2 the card view shows an accepted excerpt under the card as supporting evidence", async ({
  page,
}) => {
  held = await startHeld({ appCopy: false });
  const h = held;
  const events = [
    {
      type: "node.proposed",
      id: "quote1",
      kind: "excerpt",
      title: "Ana said it",
      status: "open",
    },
    {
      type: "edge.added",
      from: "root",
      to: "quote1",
      link: "supported_by",
    },
  ];
  appendFileSync(
    join(h.dir, ".werk", "log.jsonl"),
    events.map((e) => `${JSON.stringify(e)}\n`).join(""),
  );
  expect(h.werk("accept", "quote1", "--actor", "you").code).toBe(0);
  await page.goto(h.url);
  await expect(
    leftPane(page).getByRole("heading", { level: 1, name: "Root" }),
  ).toBeVisible();
  await expect(leftPane(page).getByText("Ana said it")).toBeVisible({
    timeout: 5000,
  });
});
