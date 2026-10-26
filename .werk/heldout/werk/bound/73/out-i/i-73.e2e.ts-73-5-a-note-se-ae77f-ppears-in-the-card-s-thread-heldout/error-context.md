# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: .werk-heldout/i-73.e2e.ts >> 73.5 a note sent to the note route appears in the card's thread
- Location: .werk-heldout/i-73.e2e.ts:198:1

# Error details

```
Error: the clipboard line

the clipboard line

expect(received).toBe(expected) // Object.is equality

Expected: "re #werk-chat \"The composer sends a live agent turn\": check the stdin path"
Received: ""

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
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
            - generic [ref=e13]: The composer sends a live agent turn
        - generic [ref=e14]:
          - navigation "Views" [ref=e15]:
            - link "Map" [ref=e16] [cursor=pointer]:
              - /url: /map/werk-chat
            - link "Board" [ref=e17] [cursor=pointer]:
              - /url: /board
          - searchbox "Search the map" [ref=e19]
    - main [ref=e20]:
      - generic [ref=e21]:
        - article [ref=e22]:
          - generic [ref=e23]:
            - button "#werk-chat" [ref=e24]
            - generic [ref=e25]: card
            - generic [ref=e26]: open
            - button "✕ Remove" [ref=e28]:
              - text: ✕
              - generic [ref=e29]: Remove
          - heading "The composer sends a live agent turn" [level=1] [ref=e30]
        - generic [ref=e31]:
          - heading "Refines" [level=2] [ref=e32]
          - list [ref=e33]:
            - listitem [ref=e34]:
              - link [ref=e35] [cursor=pointer]:
                - /url: /map/root
                - code [ref=e36]: "#root"
                - text: Root
        - generic [ref=e37]:
          - heading "Thread" [level=2] [ref=e38]
          - list [ref=e39]:
            - listitem [ref=e40]:
              - text: you
              - paragraph [ref=e42]: check the stdin path
      - form "Add a note" [ref=e43]:
        - textbox "Note" [ref=e44]:
          - /placeholder: Write a note on this card's thread
        - generic [ref=e45]:
          - button "Add note" [disabled]
  - complementary "Chat" [ref=e46]:
    - list "Chat thread" [ref=e47]
    - form "Send a message" [ref=e48]:
      - textbox "Message" [ref=e49]:
        - /placeholder: Write to the agent
      - generic [ref=e50]:
        - button "Send" [disabled]
```

# Test source

```ts
  124 | 
  125 | test("73.3 each turn starts with the card the person looks at now", async ({ page: p }) => {
  126 |   const w = await project({
  127 |     roles: {
  128 |       chat: {
  129 |         replies: [
  130 |           reply("m1", ["The fold ", "reads ", "the log."], 200),
  131 |           reply("m2", ["This ", "one ", "traces."], 200),
  132 |         ],
  133 |       },
  134 |     },
  135 |   });
  136 |   card(w, "pr-log", "The log card");
  137 |   card(w, "vi-prop-trace", "The trace card");
  138 |   await p.goto(`${w.url}/map/pr-log`);
  139 |   const composer = pane(p).getByRole("textbox", { name: "Message" });
  140 |   await composer.fill("Explain the fold");
  141 |   await pane(p).getByRole("button", { name: "Send" }).click();
  142 |   await expect(pane(p).locator(".msg.agent").first()).toContainText("The fold reads the log.");
  143 |   await expect.poll(() => chatTurns(w).flatMap((l) => l.messages).length).toBe(1);
  144 |   const first = textOf(chatTurns(w).flatMap((l) => l.messages)[0]);
  145 |   expect(first).toContain("Explain the fold");
  146 |   expect(first, "turn 1 input starts with #pr-log").toMatch(/"text":"#pr-log/);
  147 | 
  148 |   await p.goto(`${w.url}/map`);
  149 |   await p.locator('[data-tile="vi-prop-trace"]').click();
  150 |   await expect(p).toHaveURL(/\/map\/vi-prop-trace$/);
  151 |   await composer.fill("And this one?");
  152 |   await pane(p).getByRole("button", { name: "Send" }).click();
  153 |   await expect.poll(() => chatTurns(w).flatMap((l) => l.messages).length).toBe(2);
  154 |   const second = textOf(chatTurns(w).flatMap((l) => l.messages)[1]);
  155 |   expect(second).toMatch(/"text":"#vi-prop-trace/);
  156 |   expect(second).not.toMatch(/"text":"#pr-log/);
  157 |   const agents = pane(p).locator(".msg.agent");
  158 |   await expect(agents).toHaveText(["The fold reads the log.", "This one traces."]);
  159 | });
  160 | 
  161 | test("73.4 each conversation tab speaks to its own agent", async ({ page: p }) => {
  162 |   const w = await project({
  163 |     roles: {
  164 |       chat: { replies: [reply("m1", ["Answer ", "one", "."], 100), reply("m2", ["Answer ", "two", "."], 100)] },
  165 |     },
  166 |   });
  167 |   card(w, "werk-cli", "The command line");
  168 |   await p.goto(`${w.url}/map/werk-cli`);
  169 |   const tabs = pane(p).getByRole("tab");
  170 |   await expect(tabs.filter({ hasText: "alpha" }), "a conversation tab named alpha").toHaveCount(1);
  171 |   await expect(tabs.filter({ hasText: "beta" }), "a conversation tab named beta").toHaveCount(1);
  172 |   const composer = pane(p).getByRole("textbox", { name: "Message" });
  173 |   await tabs.filter({ hasText: "alpha" }).click();
  174 |   await composer.fill("First question");
  175 |   await pane(p).getByRole("button", { name: "Send" }).click();
  176 |   await tabs.filter({ hasText: "beta" }).click();
  177 |   await composer.fill("Second question");
  178 |   await pane(p).getByRole("button", { name: "Send" }).click();
  179 |   await expect(pane(p).locator(".msg.agent")).toContainText("Answer two.");
  180 |   const launches = chatTurns(w);
  181 |   expect(launches).toHaveLength(2);
  182 |   expect(launches.map((l) => l.messages.map(textOf).join("|"))).toEqual([
  183 |     expect.stringContaining("First question"),
  184 |     expect.stringContaining("Second question"),
  185 |   ]);
  186 |   expect(textOf(launches[0]?.messages)).not.toContain("Second question");
  187 |   expect(textOf(launches[1]?.messages)).not.toContain("First question");
  188 |   for (const launch of launches) {
  189 |     const prompt = launch.args.join("\n");
  190 |     expect(prompt).toMatch(/about its subject/i);
  191 |     expect(prompt).toMatch(/session/i);
  192 |     expect(prompt).toMatch(/file/i);
  193 |     expect(prompt).toMatch(/function/i);
  194 |     expect(prompt).toMatch(/line/i);
  195 |   }
  196 | });
  197 | 
  198 | test("73.5 a note sent to the note route appears in the card's thread", async ({ page: p, context }) => {
  199 |   const w = await project();
  200 |   card(w, "werk-chat", "The composer sends a live agent turn");
  201 |   await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  202 |   const noteRequests: Request[] = [];
  203 |   p.on("request", (r) => {
  204 |     if (new URL(r.url()).pathname.startsWith("/api/note")) noteRequests.push(r);
  205 |   });
  206 |   await p.goto(`${w.url}/map`);
  207 |   await expect(pane(p).getByRole("textbox", { name: "Message" })).toHaveValue("");
  208 |   const html = (await send(w.url, "/map")).body;
  209 |   const token = /name="werk-token" content="([^"]+)"/.exec(html)?.[1] ?? "";
  210 |   const before = logLines(w).length;
  211 |   const result = await send(w.url, "/api/notes", {
  212 |     method: "POST",
  213 |     token,
  214 |     body: JSON.stringify({ id: "werk-chat", text: "check the stdin path" }),
  215 |   });
  216 |   expect(result.status).toBe(200);
  217 |   const added = logLines(w).slice(before);
  218 |   expect(added).toHaveLength(1);
  219 |   expect(added[0]?.type).toBe("note.added");
  220 |   expect(added[0]?.payload.id).toBe("werk-chat");
  221 | 
  222 |   await expect
  223 |     .soft.poll(() => p.evaluate(() => navigator.clipboard.readText()), { message: "the clipboard line" })
> 224 |     .toBe('re #werk-chat "The composer sends a live agent turn": check the stdin path');
      |      ^ Error: the clipboard line
  225 | 
  226 |   await p.locator('[data-tile="werk-chat"]').click();
  227 |   await expect(p).toHaveURL(/\/map\/werk-chat$/);
  228 |   const notes = p.locator('[data-section="thread"] [data-entry="note"]').filter({ hasText: "check the stdin path" });
  229 |   await expect(notes).toHaveCount(1);
  230 |   expect(noteRequests).toHaveLength(0);
  231 | });
  232 | 
```