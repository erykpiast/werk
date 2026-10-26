# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: browser.pw.ts >> 06.2 an accepted excerpt stops being a ghost and its link goes live
- Location: browser.pw.ts:32:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('region', { name: 'Map pane' }).getByText('Ada said so')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('region', { name: 'Map pane' }).getByText('Ada said so') with timeout 5000ms
  - waiting for getByRole('region', { name: 'Map pane' }).getByText('Ada said so')

```

```yaml
- region "Map pane":
  - text: "#root"
  - article:
    - heading "Root" [level=1]
    - paragraph: The one root card.
- complementary "Chat pane":
  - textbox "Message":
    - /placeholder: Message the agent
```

# Test source

```ts
  1   | /** Held-out steps 06.2 and 14: the browser against a real werk server. */
  2   | import { readFileSync, writeFileSync } from "node:fs";
  3   | import { join } from "node:path";
  4   | import { expect, type Page, test } from "@playwright/test";
  5   | import { type Held, startHeld } from "./server.ts";
  6   | 
  7   | const ROOT = [
  8   |   {
  9   |     type: "node.proposed",
  10  |     id: "root",
  11  |     kind: "card",
  12  |     title: "Root",
  13  |     status: "open",
  14  |     why: "The one root card.",
  15  |   },
  16  |   { type: "node.accepted", id: "root", actor: "you" },
  17  | ];
  18  | const markLoaded = (page: Page) =>
  19  |   page.evaluate(() => {
  20  |     (window as unknown as { loaded: boolean }).loaded = true;
  21  |   });
  22  | const stillLoaded = (page: Page) =>
  23  |   page.evaluate(() => (window as unknown as { loaded?: boolean }).loaded === true);
  24  | const mapPane = (page: Page) => page.getByRole("region", { name: "Map pane" });
  25  | 
  26  | let held: Held | undefined;
  27  | test.afterEach(async () => {
  28  |   await held?.dispose();
  29  |   held = undefined;
  30  | });
  31  | 
  32  | test("06.2 an accepted excerpt stops being a ghost and its link goes live", async ({ page }) => {
  33  |   held = await startHeld({
  34  |     events: [
  35  |       ...ROOT,
  36  |       { type: "node.proposed", id: "q1", kind: "excerpt", title: "Ada said so", status: "open" },
  37  |       { type: "edge.added", from: "root", to: "q1", link: "supported_by", why: "she said it" },
  38  |     ],
  39  |   });
  40  |   await page.goto(held.url);
  41  |   await expect(mapPane(page).getByRole("heading", { level: 1, name: "Root" })).toBeVisible();
  42  |   const accepted = held.werk("accept", "q1", "--actor", "you");
  43  |   expect(accepted.code).toBe(0);
  44  |   const shown = held.werk("show", "root");
  45  |   expect(shown.stdout).not.toContain("[held]");
  46  |   // The card view shows the excerpt under the card as supporting evidence.
> 47  |   await expect(mapPane(page).getByText("Ada said so")).toBeVisible({ timeout: 5000 });
      |                                                        ^ Error: expect(locator).toBeVisible() failed
  48  | });
  49  | 
  50  | test("14.1 a card added from the command line appears on the open page without a reload", async ({ page }) => {
  51  |   held = await startHeld({ events: ROOT });
  52  |   await page.goto(held.url);
  53  |   await expect(mapPane(page).getByRole("heading", { level: 1, name: "Root" })).toBeVisible();
  54  |   const composer = page.getByRole("textbox", { name: "Message" });
  55  |   await composer.fill("half a thought");
  56  |   await markLoaded(page);
  57  |   const added = held.werk("add", "fresh", "--title", "Fresh idea", "--parent", "root");
  58  |   expect(added.code).toBe(0);
  59  |   await expect(mapPane(page).getByText("Fresh idea")).toBeVisible({ timeout: 15000 });
  60  |   expect(await stillLoaded(page)).toBe(true);
  61  |   await expect(composer).toHaveValue("half a thought");
  62  | });
  63  | 
  64  | test("14.2 in dev, a server edit changes a response and the live page stays connected", async ({ page }) => {
  65  |   held = await startHeld({ events: ROOT, appCopy: true });
  66  |   await page.goto(held.url);
  67  |   await expect(mapPane(page).getByRole("heading", { level: 1, name: "Root" })).toBeVisible();
  68  |   await markLoaded(page);
  69  |   const pidBefore = held.listenerPid();
  70  |   const before = await (await fetch(`${held.url}/api/graph`)).json();
  71  |   expect(before.error).toBe("the graph is read with shape=1");
  72  | 
  73  |   const routes = join(held.appDir, "src", "serve", "routes.ts");
  74  |   const text = readFileSync(routes, "utf8");
  75  |   expect(text).toContain("the graph is read with shape=1");
  76  |   writeFileSync(routes, text.replace("the graph is read with shape=1", "edited by the person"));
  77  | 
  78  |   await expect
  79  |     .poll(async () => (await (await fetch(`${held?.url}/api/graph`)).json()).error, { timeout: 30000 })
  80  |     .toBe("edited by the person");
  81  |   expect(held.output()).toMatch(/reusing the live server/);
  82  |   expect(held.listenerPid()).toBe(pidBefore);
  83  | 
  84  |   const added = held.werk("add", "after", "--title", "After edit", "--parent", "root");
  85  |   expect(added.code).toBe(0);
  86  |   await expect(mapPane(page).getByText("After edit")).toBeVisible({ timeout: 15000 });
  87  |   expect(await stillLoaded(page)).toBe(true);
  88  | });
  89  | 
  90  | test("14.3 in dev, a client edit that cannot apply in place reloads the page and keeps the draft", async ({ page }) => {
  91  |   held = await startHeld({ events: ROOT, appCopy: true });
  92  |   await page.goto(held.url);
  93  |   const title = mapPane(page).getByRole("heading", { level: 1, name: "Root" });
  94  |   await expect(title).toBeVisible();
  95  |   const composer = page.getByRole("textbox", { name: "Message" });
  96  |   await composer.fill("draft that must survive");
  97  |   await markLoaded(page);
  98  |   const entry = join(held.appDir, "client", "main.tsx");
  99  |   writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// edited by the person\n`);
  100 |   await expect.poll(() => stillLoaded(page), { timeout: 30000 }).toBe(false);
  101 |   await expect(title).toBeVisible();
  102 |   await expect(composer).toHaveValue("draft that must survive");
  103 | });
  104 | 
```