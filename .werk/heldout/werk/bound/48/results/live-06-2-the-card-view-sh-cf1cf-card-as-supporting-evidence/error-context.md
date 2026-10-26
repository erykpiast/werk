# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: live.spec.ts >> 06.2 the card view shows an accepted excerpt under the card as supporting evidence
- Location: .werk-heldout/e2e/live.spec.ts:107:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('region', { name: 'Map pane' }).getByText('Ana said it')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('region', { name: 'Map pane' }).getByText('Ana said it') with timeout 5000ms
  - waiting for getByRole('region', { name: 'Map pane' }).getByText('Ana said it')

```

```yaml
- region "Map pane":
  - text: "#root"
  - article:
    - heading "Root" [level=1]
    - paragraph: The top of the map.
- complementary "Chat pane":
  - textbox "Message":
    - /placeholder: Message the agent
```

# Test source

```ts
  36  |     "--title",
  37  |     "Fresh idea",
  38  |     "--parent",
  39  |     "root",
  40  |   );
  41  |   expect(added.code).toBe(0);
  42  |   await expect(leftPane(page).getByText("Fresh idea")).toBeVisible();
  43  |   expect(await stillLoaded(page)).toBe(true);
  44  |   await expect(composer).toHaveValue("half a thought");
  45  | });
  46  | 
  47  | test("14.2 a server edit changes the response, reuses the live server, and the live channel stays", async ({
  48  |   page,
  49  | }) => {
  50  |   held = await startHeld({ appCopy: true });
  51  |   const h = held;
  52  |   await page.goto(h.url);
  53  |   await expect(leftPane(page).getByRole("heading", { level: 1 })).toBeVisible();
  54  |   await markLoaded(page);
  55  |   const served = /serving on http:\/\/127\.0\.0\.1:(\d+) \(pid (\d+)\)/.exec(
  56  |     h.output(),
  57  |   );
  58  |   expect(served).not.toBeNull();
  59  |   const [, port, pid] = served as RegExpExecArray;
  60  |   const before = await (await fetch(`${h.url}/api/graph`)).json();
  61  |   expect(before.error).toBe("the graph is read with shape=1");
  62  | 
  63  |   const routes = join(h.appDir, "src", "serve", "routes.ts");
  64  |   const text = readFileSync(routes, "utf8");
  65  |   expect(text).toContain("the graph is read with shape=1");
  66  |   writeFileSync(
  67  |     routes,
  68  |     text.replace("the graph is read with shape=1", "edited response"),
  69  |   );
  70  | 
  71  |   await expect
  72  |     .poll(() => h.output(), { timeout: 20000 })
  73  |     .toContain("reusing the live server");
  74  |   await expect
  75  |     .poll(async () => (await (await fetch(`${h.url}/api/graph`)).json()).error, {
  76  |       timeout: 20000,
  77  |     })
  78  |     .toBe("edited response");
  79  |   expect(Number(port)).toBe(h.port);
  80  |   expect(() => process.kill(Number(pid), 0)).not.toThrow();
  81  |   const again = /serving on http:\/\/127\.0\.0\.1:(\d+) \(pid (\d+)\)/g;
  82  |   expect([...h.output().matchAll(again)]).toHaveLength(1);
  83  | 
  84  |   expect(h.werk("add", "after", "--title", "After edit", "--parent", "root").code).toBe(0);
  85  |   await expect(leftPane(page).getByText("After edit")).toBeVisible();
  86  |   expect(await stillLoaded(page)).toBe(true);
  87  | });
  88  | 
  89  | test("14.3 a client edit that cannot apply in place reloads the page and keeps the draft", async ({
  90  |   page,
  91  | }) => {
  92  |   held = await startHeld({ appCopy: true });
  93  |   const h = held;
  94  |   await page.goto(h.url);
  95  |   const title = leftPane(page).getByRole("heading", { level: 1 });
  96  |   await expect(title).toHaveText("Root");
  97  |   const composer = page.getByRole("textbox", { name: "Message" });
  98  |   await composer.fill("draft that must survive");
  99  |   await markLoaded(page);
  100 |   const entry = join(h.appDir, "client", "main.tsx");
  101 |   writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// edited\n`);
  102 |   await expect.poll(() => stillLoaded(page), { timeout: 20000 }).toBe(false);
  103 |   await expect(title).toHaveText("Root");
  104 |   await expect(composer).toHaveValue("draft that must survive");
  105 | });
  106 | 
  107 | test("06.2 the card view shows an accepted excerpt under the card as supporting evidence", async ({
  108 |   page,
  109 | }) => {
  110 |   held = await startHeld({ appCopy: false });
  111 |   const h = held;
  112 |   const events = [
  113 |     {
  114 |       type: "node.proposed",
  115 |       id: "quote1",
  116 |       kind: "excerpt",
  117 |       title: "Ana said it",
  118 |       status: "open",
  119 |     },
  120 |     {
  121 |       type: "edge.added",
  122 |       from: "root",
  123 |       to: "quote1",
  124 |       link: "supported_by",
  125 |     },
  126 |   ];
  127 |   appendFileSync(
  128 |     join(h.dir, ".werk", "log.jsonl"),
  129 |     events.map((e) => `${JSON.stringify(e)}\n`).join(""),
  130 |   );
  131 |   expect(h.werk("accept", "quote1", "--actor", "you").code).toBe(0);
  132 |   await page.goto(h.url);
  133 |   await expect(
  134 |     leftPane(page).getByRole("heading", { level: 1, name: "Root" }),
  135 |   ).toBeVisible();
> 136 |   await expect(leftPane(page).getByText("Ana said it")).toBeVisible({
      |                                                         ^ Error: expect(locator).toBeVisible() failed
  137 |     timeout: 5000,
  138 |   });
  139 | });
  140 | 
```