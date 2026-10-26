# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e/rendered-text.e2e.ts >> fenced code in a card is boxed, labelled and highlighted by its tag
- Location: e2e/rendered-text.e2e.ts:86:1

# Error details

```
Error: expect(received).toBeGreaterThan(expected)

Expected: > 0
Received:   0
```

# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e3]:
    - banner [ref=e4]:
      - generic [ref=e5]:
        - navigation "Breadcrumbs" [ref=e7]:
          - generic [ref=e8]:
            - button "Home" [ref=e9]
            - generic [ref=e10]: ›
            - button "Root" [ref=e11]
            - generic [ref=e12]: ›
            - generic [ref=e13]: code-sample
        - generic [ref=e14]:
          - navigation "Views" [ref=e15]:
            - link "Map" [ref=e16] [cursor=pointer]:
              - /url: /map/code-sample
            - link "Board" [ref=e17] [cursor=pointer]:
              - /url: /board
          - searchbox "Search the map" [ref=e19]
    - main [ref=e20]:
      - generic [ref=e21]:
        - article [ref=e22]:
          - generic [ref=e23]:
            - button "#code-sample" [ref=e24]
            - generic [ref=e25]: card
            - generic [ref=e26]: open
            - button "✕ Remove" [ref=e28]:
              - text: ✕
              - generic [ref=e29]: Remove
          - heading [level=1] [ref=e30]:
            - code [ref=e32]: "#code-sample"
          - generic [ref=e33]:
            - generic [ref=e34]:
              - generic: zsh
              - code [ref=e36]: "echo $HOME | grep -v x #al-diff"
            - generic [ref=e37]:
              - generic: TypeScript
              - code [ref=e39]: "const n: number = 1 // #al-diff"
            - generic [ref=e40]:
              - generic: cobol
              - code [ref=e42]: DISPLAY 'HELLO'. al-diff
            - code [ref=e45]: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx #al-diff"
        - generic [ref=e46]:
          - heading "Refines" [level=2] [ref=e47]
          - list [ref=e48]:
            - listitem [ref=e49]:
              - link [ref=e50] [cursor=pointer]:
                - /url: /map/root
                - code [ref=e51]: "#root"
                - text: Root
        - generic [ref=e52]:
          - heading "Thread" [level=2] [ref=e53]
          - paragraph [ref=e54]: No notes yet.
      - form "Add a note" [ref=e55]:
        - textbox "Note" [ref=e56]:
          - /placeholder: Write a note on this card's thread
        - generic [ref=e57]:
          - button "Add note" [disabled]
  - complementary "Chat" [ref=e58]:
    - list "Chat thread" [ref=e59]
    - form "Send a message" [ref=e60]:
      - textbox "Message" [ref=e61]:
        - /placeholder: Write to the agent
      - generic [ref=e62]:
        - button "Send" [disabled]
```

# Test source

```ts
  17  |   return at.evaluate((el) => getComputedStyle(el).color);
  18  | }
  19  | 
  20  | test("every form of a card reference in a card body becomes the same link to that card", async ({ page: p }) => {
  21  |   const w = await project();
  22  |   card(w, "al-diff", { title: "Every proposed change is a diff" });
  23  |   card(w, "align");
  24  |   card(w, "notes-test", { body: "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too." });
  25  |   await p.goto(`${w.url}/map/notes-test`);
  26  | 
  27  |   const links = body(p).locator("a");
  28  |   await expect(links).toHaveText(["#al-diff", "#al-diff", "#al-diff", "#al-diff", "#align"]);
  29  |   for (const code of await body(p).locator('a[href="/map/al-diff"] code').all()) {
  30  |     expect(await code.evaluate((el) => getComputedStyle(el).fontFamily)).toContain("monospace");
  31  |   }
  32  |   await expect(body(p).locator('a[href="/map/align"]')).toHaveCount(1);
  33  |   const prose = await body(p)
  34  |     .locator("p")
  35  |     .evaluate((el) => {
  36  |       const copy = el.cloneNode(true) as typeof el;
  37  |       for (const a of Array.from(copy.querySelectorAll("a"))) a.remove();
  38  |       return copy.textContent ?? "";
  39  |     });
  40  |   expect(prose).toBe("See , then , then , then , and  too.");
  41  | 
  42  |   await links.nth(1).click();
  43  |   await expect(p).toHaveURL(/\/map\/al-diff$/);
  44  |   await expect(p.getByRole("heading", { level: 1 })).toHaveText("Every proposed change is a diff");
  45  | });
  46  | 
  47  | test("text that only looks like a reference stays text", async ({ page: p }) => {
  48  |   const w = await project();
  49  |   card(w, "al-diff");
  50  |   const lines = [
  51  |     "--al-diff",
  52  |     "##al-diff",
  53  |     "&al-diff",
  54  |     "a code span holding `node src/cli.ts show #al-diff`",
  55  |     "see #no-such-card",
  56  |     "visit https://example.com/page#al-diff",
  57  |     "# al-diff",
  58  |     "And #al-diff on its own.",
  59  |   ];
  60  |   card(w, "guards", { body: lines.join("\n\n") });
  61  |   await p.goto(`${w.url}/map/guards`);
  62  | 
  63  |   for (const text of [
  64  |     "--al-diff",
  65  |     "##al-diff",
  66  |     "&al-diff",
  67  |     "see #no-such-card",
  68  |     "visit https://example.com/page#al-diff",
  69  |   ]) {
  70  |     const para = body(p).locator("p").filter({ hasText: text });
  71  |     await expect(para).toHaveText(text);
  72  |     await expect(para.locator("a")).toHaveCount(0);
  73  |   }
  74  |   const command = body(p).locator("code", { hasText: "node src/cli.ts show #al-diff" });
  75  |   await expect(command).toHaveText("node src/cli.ts show #al-diff");
  76  |   await expect(command.locator("a")).toHaveCount(0);
  77  |   await expect(body(p).locator("h1")).toHaveText("al-diff");
  78  |   await expect(body(p).locator("h1 a")).toHaveCount(0);
  79  | 
  80  |   const links = body(p).locator("a");
  81  |   await expect(links).toHaveCount(1);
  82  |   await expect(links).toHaveAttribute("href", "/map/al-diff");
  83  |   await expect(links).toHaveText("#al-diff");
  84  | });
  85  | 
  86  | test("fenced code in a card is boxed, labelled and highlighted by its tag", async ({ page: p }) => {
  87  |   await p.setViewportSize({ width: 1280, height: 720 });
  88  |   const w = await project();
  89  |   card(w, "al-diff");
  90  |   const fences = [
  91  |     ...["```zsh", "echo $HOME | grep -v x #al-diff", "```"],
  92  |     ...["```TypeScript", "const n: number = 1 // #al-diff", "```"],
  93  |     ...["```cobol", "DISPLAY 'HELLO'. al-diff", "```"],
  94  |     ...["```", `${"x".repeat(400)} #al-diff`, "```"],
  95  |   ];
  96  |   card(w, "code-sample", { body: fences.join("\n") });
  97  |   await p.goto(`${w.url}/map/code-sample`);
  98  | 
  99  |   const boxes = body(p).locator(".codebox");
  100 |   await expect(boxes).toHaveCount(4);
  101 |   const [zsh, ts, cobol, plain] = [boxes.nth(0), boxes.nth(1), boxes.nth(2), boxes.nth(3)];
  102 | 
  103 |   await expect(zsh.locator(".codebox-tag")).toHaveText("zsh");
  104 |   const shellColours = await zsh
  105 |     .locator("code span")
  106 |     .evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size);
  107 |   expect(shellColours).toBeGreaterThanOrEqual(3);
  108 | 
  109 |   await expect(ts.locator(".tok-kw").first()).toHaveText("const");
  110 |   expect(await colour(ts.locator(".tok-kw").first())).not.toBe(await colour(ts.locator("code")));
  111 | 
  112 |   await expect(cobol.locator(".codebox-tag")).toHaveText("cobol");
  113 |   await expect(cobol.locator("code span")).toHaveCount(0);
  114 |   await expect(cobol.locator("code")).toHaveText("DISPLAY 'HELLO'. al-diff");
  115 | 
  116 |   const scroll = await plain.locator("pre").evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth }));
> 117 |   expect(scroll.inner).toBeGreaterThan(scroll.outer);
      |                        ^ Error: expect(received).toBeGreaterThan(expected)
  118 |   const page = await p.evaluate(() => ({
  119 |     scroll: document.documentElement.scrollWidth,
  120 |     client: document.documentElement.clientWidth,
  121 |   }));
  122 |   expect(page.scroll).toBeLessThanOrEqual(page.client);
  123 | 
  124 |   await expect(boxes.locator("a")).toHaveCount(0);
  125 | });
  126 | 
  127 | test("card text with a script tag shows the tag as text and runs nothing", async ({ page: p }) => {
  128 |   const w = await project();
  129 |   card(w, "unsafe", { body: "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~" });
  130 |   await p.goto(`${w.url}/map/unsafe`);
  131 | 
  132 |   await expect(body(p).locator("p")).toContainText("<script>window.__pwned = true</script>");
  133 |   await expect(body(p).locator("script")).toHaveCount(0);
  134 |   expect(await p.evaluate(() => (globalThis as { __pwned?: unknown }).__pwned)).toBeUndefined();
  135 |   await expect(body(p).locator("strong")).toHaveText("bold");
  136 |   await expect(body(p).locator("strong")).toHaveCSS("font-weight", "700");
  137 |   await expect(body(p).locator("del")).toHaveText("gone");
  138 |   await expect(body(p).locator("del")).toHaveCSS("text-decoration-line", "line-through");
  139 | });
  140 | 
  141 | test("references link in chat messages but not in a grid tile summary", async ({ page: p }) => {
  142 |   const head = 'Here it is:\n```json\n{"card": "al-diff", "depth": ';
  143 |   const tail = '2, "open": true}\n```';
  144 |   const stream = (event: object) => ({ event: { type: "stream_event", event } });
  145 |   const w = await project({
  146 |     roles: {
  147 |       chat: {
  148 |         replies: [
  149 |           [
  150 |             stream({ type: "message_start", message: { id: "msg-1" } }),
  151 |             stream({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
  152 |             stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: head } }),
  153 |             { pause: 2000 },
  154 |             stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: tail } }),
  155 |             {
  156 |               event: {
  157 |                 type: "assistant",
  158 |                 message: { id: "msg-1", content: [{ type: "text", text: head + tail }] },
  159 |               },
  160 |             },
  161 |           ],
  162 |         ],
  163 |       },
  164 |     },
  165 |   });
  166 |   card(w, "al-diff");
  167 |   card(w, "old-idea");
  168 |   w.seed("node.removed", { id: "old-idea" });
  169 |   card(w, "tile-card", { title: "A tile", why: "Depends on #al-diff" });
  170 |   await p.goto(`${w.url}/map`);
  171 | 
  172 |   const pane = p.getByRole("complementary", { name: "Chat" });
  173 |   await pane.getByRole("textbox", { name: "Message" }).fill("Compare #al-diff with #old-idea and show code");
  174 |   await pane.getByRole("button", { name: "Send" }).click();
  175 |   const mine = pane.locator(".msg.user");
  176 |   await expect(mine.locator("a")).toHaveCount(1);
  177 |   await expect(mine.locator("a")).toHaveAttribute("href", "/map/al-diff");
  178 |   await expect(mine.locator("a")).toHaveText("#al-diff");
  179 |   await expect(mine).toContainText("with #old-idea and");
  180 | 
  181 |   const reply = pane.locator(".msg.agent");
  182 |   await expect(reply.locator(".codebox .codebox-tag")).toHaveText("json");
  183 |   await expect(reply.locator(".codebox code")).toHaveText('{"card": "al-diff", "depth": ');
  184 |   const code = reply.locator(".codebox code");
  185 |   await expect(code).toHaveText('{"card": "al-diff", "depth": 2, "open": true}');
  186 |   const colours = new Set([
  187 |     await colour(reply.locator(".tok-key").first()),
  188 |     await colour(reply.locator(".tok-str").first()),
  189 |     await colour(code),
  190 |   ]);
  191 |   expect(colours.size).toBe(3);
  192 | 
  193 |   const tile = p.locator('a[data-tile="tile-card"]');
  194 |   await expect(tile.locator('[data-role="why"]')).toHaveText("Depends on #al-diff");
  195 |   await expect(tile.locator("a")).toHaveCount(0);
  196 |   await tile.click();
  197 |   await expect(p).toHaveURL(/\/map\/tile-card$/);
  198 |   await expect(p.getByRole("heading", { level: 1 })).toHaveText("A tile");
  199 | });
  200 | 
```