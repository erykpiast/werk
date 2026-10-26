# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: .werk-heldout/e-chat.e2e.ts >> 73.1 a message sent from the open card streams its reply back into the pane
- Location: .werk-heldout/e-chat.e2e.ts:61:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('complementary', { name: 'Chat' }).getByRole('tab', { name: 'design', selected: true })
Expected: visible
Timeout: 3000ms
Error: element(s) not found

Call log:
  - Expect "soft toBeVisible" getByRole('complementary', { name: 'Chat' }).getByRole('tab', { name: 'design', selected: true }) with timeout 3000ms
  - waiting for getByRole('complementary', { name: 'Chat' }).getByRole('tab', { name: 'design', selected: true })

```

```yaml
- banner:
  - navigation "Breadcrumbs":
    - button "Home"
    - text: ›
    - button "Root"
    - text: › The composer sends a live agent turn
  - navigation "Views":
    - link "Map":
      - /url: /map/werk-chat
    - link "Board":
      - /url: /board
  - searchbox "Search the map"
- main:
  - article:
    - button "#werk-chat"
    - text: card decided I decide
    - button "✕ Remove"
    - heading "The composer sends a live agent turn" [level=1]
  - heading "Refines" [level=2]
  - list:
    - listitem:
      - link "#root Root":
        - /url: /map/root
        - code: "#root"
        - text: Root
  - heading "Thread" [level=2]
  - paragraph: No notes yet.
  - form "Add a note":
    - textbox "Note":
      - /placeholder: Write a note on this card's thread
    - button "Add note" [disabled]
- complementary "Chat":
  - list "Chat thread"
  - form "Send a message":
    - textbox "Message":
      - /placeholder: Write to the agent
    - button "Send" [disabled]
```

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 1
Received: 0

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Test source

```ts
  1   | // Held-out steps 73.x: the chat pane sends a turn from the open card and streams the reply back.
  2   | import { readFileSync } from "node:fs";
  3   | import { dirname, join } from "node:path";
  4   | import { expect, type Page, type Request, test } from "@playwright/test";
  5   | import { project, stop, type Werk } from "../e2e/project.ts";
  6   | 
  7   | test.afterEach(stop);
  8   | 
  9   | const stream = (event: object) => ({ event: { type: "stream_event", event } });
  10  | 
  11  | /** A scripted reply in parts, with a pause between parts. */
  12  | function reply(id: string, parts: string[], pause = 0): object[] {
  13  |   const steps: object[] = [
  14  |     stream({ type: "message_start", message: { id } }),
  15  |     stream({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
  16  |   ];
  17  |   parts.forEach((part, i) => {
  18  |     if (i > 0 && pause > 0) steps.push({ pause });
  19  |     steps.push(stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: part } }));
  20  |   });
  21  |   steps.push({ event: { type: "assistant", message: { id, content: [{ type: "text", text: parts.join("") }] } } });
  22  |   return steps;
  23  | }
  24  | 
  25  | type Launch = { pid: number; args: string[]; role: string; messages: unknown[] };
  26  | 
  27  | function launches(w: Werk): Launch[] {
  28  |   let text = "";
  29  |   try {
  30  |     text = readFileSync(join(dirname(w.dir), "fake", "launches.jsonl"), "utf8");
  31  |   } catch {
  32  |     return [];
  33  |   }
  34  |   const out: Launch[] = [];
  35  |   for (const line of text.split("\n").filter(Boolean)) {
  36  |     const e = JSON.parse(line);
  37  |     if (e.kind === "launch") out.push({ pid: e.pid, args: e.args, role: e.role, messages: [] });
  38  |     else out.findLast((l) => l.pid === e.pid)?.messages.push(e.message);
  39  |   }
  40  |   return out;
  41  | }
  42  | 
  43  | const turnText = (m: unknown) =>
  44  |   ((m as { message?: { content?: { text?: string }[] } }).message?.content ?? []).map((c) => c.text ?? "").join("");
  45  | 
  46  | function card(w: Pick<Werk, "seed">, id: string, title = id): void {
  47  |   w.seed("node.added", { id, kind: "card", title, parent: "root", status: "decided", who: "me" });
  48  | }
  49  | 
  50  | const pane = (p: Page) => p.getByRole("complementary", { name: "Chat" });
  51  | const composer = (p: Page) => pane(p).getByRole("textbox", { name: "Message" });
  52  | 
  53  | function chatRequests(p: Page): Request[] {
  54  |   const seen: Request[] = [];
  55  |   p.on("request", (r) => {
  56  |     if (r.method() === "POST" && new URL(r.url()).pathname.startsWith("/api/chat")) seen.push(r);
  57  |   });
  58  |   return seen;
  59  | }
  60  | 
  61  | test("73.1 a message sent from the open card streams its reply back into the pane", async ({ page: p }) => {
  62  |   const w = await project(
  63  |     {
  64  |       roles: {
  65  |         chat: { replies: [reply("m1", ["It decides ", "that **turns** stream ", "and links #werk-wording."], 2000)] },
  66  |       },
  67  |     },
  68  |     (d) => {
  69  |       card(d, "werk-chat", "The composer sends a live agent turn");
  70  |       card(d, "werk-wording", "Wording");
  71  |     },
  72  |   );
  73  |   const sent = chatRequests(p);
  74  |   await p.goto(`${w.url}/map/werk-chat`);
  75  |   await expect(pane(p)).toBeVisible();
  76  |   // The conversation tab "design" is the active tab.
  77  |   await expect.soft(pane(p).getByRole("tab", { name: "design", selected: true })).toBeVisible({ timeout: 3000 });
  78  |   await composer(p).fill("What does this card decide?");
  79  |   await composer(p).press("Enter");
> 80  |   await expect.poll(() => sent.length).toBe(1);
      |                                        ^ Error: expect(received).toBe(expected) // Object.is equality
  81  |   const body = sent[0]?.postDataJSON() as Record<string, unknown>;
  82  |   expect(JSON.stringify(body)).toContain("What does this card decide?");
  83  |   expect(JSON.stringify(body)).toContain("werk-chat");
  84  |   expect(JSON.stringify(body)).toContain("design");
  85  |   await expect(composer(p)).toHaveValue("");
  86  |   const agent = pane(p).locator(".msg.agent");
  87  |   await expect(agent).toContainText("It decides");
  88  |   await expect(agent).not.toContainText("#werk-wording");
  89  |   await expect(agent.locator("strong")).toHaveText("turns");
  90  |   const link = agent.locator('a[href="/map/werk-wording"]');
  91  |   await expect(link).toHaveText("#werk-wording");
  92  |   await link.click();
  93  |   await expect(p).toHaveURL(/\/map\/werk-wording$/);
  94  | });
  95  | 
  96  | test("73.2 a pasted image travels with the message in the same request", async ({ page: p, context }) => {
  97  |   await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  98  |   const w = await project({ roles: { chat: { replies: [reply("m1", ["The layout ", "matches."])] } } }, (d) =>
  99  |     card(d, "visual", "Visual"),
  100 |   );
  101 |   const sent = chatRequests(p);
  102 |   await p.goto(`${w.url}/map/visual`);
  103 |   await composer(p).focus();
  104 |   // Paste one PNG through a paste event with an image file on its clipboard data.
  105 |   await composer(p).evaluate((el) => {
  106 |     const png = Uint8Array.from(
  107 |       atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
  108 |       (c) => c.charCodeAt(0),
  109 |     );
  110 |     const data = new DataTransfer();
  111 |     data.items.add(new File([png], "shot.png", { type: "image/png" }));
  112 |     el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  113 |   });
  114 |   await composer(p).pressSequentially("Does this layout match the card?");
  115 |   await composer(p).press("Enter");
  116 |   await expect.poll(() => sent.length).toBe(1);
  117 |   const raw = sent[0]?.postData() ?? "";
  118 |   expect(raw).toContain("Does this layout match the card?");
  119 |   expect(raw).toMatch(/image\/png|iVBORw0KGgo/);
  120 |   expect(raw).toContain("visual");
  121 |   await expect(pane(p).locator(".msg.agent")).toContainText("The layout matches.");
  122 | });
  123 | 
  124 | test("73.3 each turn starts with the card the person looks at now", async ({ page: p }) => {
  125 |   const w = await project(
  126 |     {
  127 |       roles: {
  128 |         chat: { replies: [reply("m1", ["The fold reads the log."]), reply("m2", ["This one traces a mark."])] },
  129 |       },
  130 |     },
  131 |     (d) => {
  132 |       card(d, "pr-log", "The log");
  133 |       card(d, "vi-prop-trace", "The trace");
  134 |     },
  135 |   );
  136 |   await p.goto(`${w.url}/map/pr-log`);
  137 |   await composer(p).fill("Explain the fold");
  138 |   await pane(p).getByRole("button", { name: "Send" }).click();
  139 |   await expect(pane(p).locator(".msg.agent")).toContainText("The fold reads the log.");
  140 |   const first = () =>
  141 |     launches(w)
  142 |       .flatMap((l) => l.messages)
  143 |       .map(turnText);
  144 |   expect(first()[0]?.startsWith("#pr-log")).toBe(true);
  145 |   await p.goto(`${w.url}/map`);
  146 |   await p.locator('a[data-tile="vi-prop-trace"]').click();
  147 |   await composer(p).fill("And this one?");
  148 |   await pane(p).getByRole("button", { name: "Send" }).click();
  149 |   await expect(pane(p).locator(".msg.agent").nth(1)).toContainText("This one traces a mark.");
  150 |   const second = first()[1] ?? "";
  151 |   expect(second.startsWith("#vi-prop-trace")).toBe(true);
  152 |   expect(second.startsWith("#pr-log")).toBe(false);
  153 | });
  154 | 
  155 | test("73.4 each conversation tab speaks to its own agent", async ({ page: p }) => {
  156 |   const w = await project({ roles: { chat: { replies: [reply("m1", ["One."]), reply("m2", ["Two."])] } } }, (d) =>
  157 |     card(d, "werk-cli", "The command line"),
  158 |   );
  159 |   await p.goto(`${w.url}/map/werk-cli`);
  160 |   const tab = (name: string) => pane(p).getByRole("tab", { name });
  161 |   await expect(tab("alpha")).toBeVisible({ timeout: 3000 });
  162 |   await expect(tab("beta")).toBeVisible();
  163 |   await tab("alpha").click();
  164 |   await composer(p).fill("First question");
  165 |   await pane(p).getByRole("button", { name: "Send" }).click();
  166 |   await tab("beta").click();
  167 |   await composer(p).fill("Second question");
  168 |   await pane(p).getByRole("button", { name: "Send" }).click();
  169 |   const chats = launches(w).filter((l) => l.role === "chat");
  170 |   expect(chats).toHaveLength(2);
  171 |   const prompt = chats.map((l) => l.args.join(" ")).join("\n");
  172 |   expect(prompt).toMatch(/subject/);
  173 |   expect(prompt).toMatch(/file|function|line/);
  174 | });
  175 | 
  176 | test("73.5 a note sent to the note route appears in the card's thread", async ({ page: p, context }) => {
  177 |   await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  178 |   const w = await project(undefined, (d) => card(d, "werk-chat", "The composer sends a live agent turn"));
  179 |   const log = join(w.dir, ".werk", "log.jsonl");
  180 |   const lines = () => readFileSync(log, "utf8").split("\n").filter(Boolean);
```