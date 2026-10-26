// Held-out: chat pane steps 19.2, 20.1-20.5, 73.1-73.5.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { project, stop } from "../e2e/project.ts";
import { box, done, launches, more, open, pane, reply, say, start, stream, turns } from "./g-util.ts";

test.afterEach(stop);

const fakeOf = (dir: string) => join(dir, "..", "fake");
const seedLine = (seq: number, type: string, payload: object) =>
  JSON.stringify({ seq, at: "t", actor: "you", type, payload });

test("19.2 chat agent gets instructions and build-rule titles; sample agent does not", async ({ page: p }) => {
  const w = await project({ roles: { chat: { replies: [reply("m1", "ok")] } } }, (s) => {
    s.seed("node.added", { id: "how", kind: "card", title: "Build rules", parent: "root" });
    s.seed("node.added", {
      id: "rule-a",
      kind: "card",
      title: "Tests run under Bun",
      parent: "how",
      status: "decided",
    });
    s.seed("node.added", { id: "rule-b", kind: "card", title: "Lint with Biome", parent: "how", status: "decided" });
    s.seed("node.added", { id: "open-x", kind: "card", title: "An open card", parent: "root" });
  });
  await p.goto(`${w.url}/map`);
  await say(p, "hello");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("ok");
  const chat = launches(fakeOf(w.dir)).find((l) => l.role === "chat");
  const args = chat?.args.join("\n") ?? "";
  expect(args).toContain("how to work with the decision map");
  expect(args).toContain("This project's build rules");
  expect(args).toContain("Tests run under Bun");
  expect(args).toContain("Lint with Biome");
  // Sampling options for an open card: look for any control in the page.
  await p.goto(`${w.url}/map/open-x`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("An open card");
  const sample = p.getByRole("button", { name: /sample/i });
  expect(await sample.count(), "no control to sample options for an open card").toBeGreaterThan(0);
});

test("20.1 a message streams a reply and the map shows the card the agent writes", async ({ page: p }) => {
  const base = [
    seedLine(1, "node.added", { id: "root", kind: "card", title: "Root" }),
    seedLine(2, "node.added", {
      id: "retry",
      kind: "card",
      title: "Checkout retries",
      body: "Two tries.",
      parent: "root",
    }),
  ];
  const edited = `${[...base, seedLine(3, "node.bodyEdited", { id: "retry", body: "Three tries." })].join("\n")}\n`;
  const full = "Use **three** tries, see #retry.";
  const w = await project(
    {
      roles: {
        chat: {
          replies: [
            [
              start("m1"),
              open("Use **three**"),
              stream({ type: "message_delta", usage: { output_tokens: 42 } }),
              { pause: 2000 },
              more(" tries"),
              { edit: { path: ".werk/log.jsonl", content: edited } },
              { pause: 3000 },
              more(", see #retry."),
              done("m1", full),
            ],
          ],
        },
      },
    },
    (s) =>
      s.seed("node.added", {
        id: "retry",
        kind: "card",
        title: "Checkout retries",
        body: "Two tries.",
        parent: "root",
      }),
  );
  await p.goto(`${w.url}/map/retry`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Checkout retries");
  await say(p, "Make it three tries");
  await expect(turns(p).nth(0).locator(".msg.user")).toHaveText("Make it three tries", { timeout: 1000 });
  // part by part
  await expect(turns(p).nth(0).locator(".msg.agent")).toContainText("Use three");
  await expect(turns(p).nth(0).locator(".msg.agent")).not.toContainText("tries");
  const header = pane(p).getByRole("status", { name: "Turn state" });
  await expect(header).toHaveText(/writing · \d+s · 42 tokens/);
  await expect(turns(p).nth(0).locator(".msg.agent")).toContainText("Use three tries");
  // map redraws before reply ends
  await expect(p.locator('[data-field="body"]')).toHaveText("Three tries.");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toHaveCount(0);
  // reply ends
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("Use three tries, see #retry.");
  await expect(turns(p).nth(0).locator(".msg.agent strong")).toHaveText("three");
  await expect(header).not.toHaveText(/writing/);
  await expect(header.locator(".animate-pulse")).toHaveCount(0);
  const link = turns(p).nth(0).locator('.msg.agent a[href$="/map/retry"]');
  await expect(link).toHaveCount(1);
  await p.goto(`${w.url}/map`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Root");
  // the full reply stays under the message after a fresh view? (the thread is live state; click the link before nav)
});

test("20.1b the card id link in the reply opens that card", async ({ page: p }) => {
  const w = await project({ roles: { chat: { replies: [reply("m1", "See #retry now")] } } }, (s) =>
    s.seed("node.added", { id: "retry", kind: "card", title: "Checkout retries", parent: "root" }),
  );
  await p.goto(`${w.url}/map`);
  await say(p, "where?");
  const link = turns(p).nth(0).locator('.msg.agent a[href$="/map/retry"]');
  await link.click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Checkout retries");
});

test("20.2 a second message waits and the first reply finishes above it", async ({ page: p }) => {
  const w = await project({
    roles: {
      chat: {
        replies: [
          [
            start("m1"),
            open("Part one"),
            { pause: 3000 },
            more(" and part two."),
            done("m1", "Part one and part two."),
          ],
          reply("m2", "Second answer."),
        ],
      },
    },
  });
  await p.goto(`${w.url}/map`);
  await say(p, "First question");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("Part one");
  await say(p, "Second question");
  await expect(turns(p).nth(1).locator(".msg.user")).toHaveText("Second question", { timeout: 1000 });
  await expect(turns(p).nth(1).locator('[data-mark="waiting"]')).toContainText("waits for the reply above");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("Part one and part two.");
  await expect(turns(p).nth(0).locator(".msg.user")).toHaveText("First question");
  await expect(turns(p).nth(1).locator('[data-mark="waiting"]')).toHaveCount(0);
  await expect(turns(p).nth(1).locator(".msg.agent")).toHaveText("Second answer.");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveCount(1);
});

test("20.3 each turn names the card the person has open", async ({ page: p }) => {
  const w = await project(
    { roles: { chat: { replies: [reply("m1", "r1"), reply("m2", "r2"), reply("m3", "r3")] } } },
    (s) =>
      s.seed("node.added", {
        id: "retry",
        kind: "card",
        title: "Checkout retries",
        why: "Cards fail at random",
        body: "Retry two times then stop.",
        parent: "root",
      }),
  );
  await p.goto(`${w.url}/map/retry`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Checkout retries");
  await say(p, "What does this say?");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("r1");
  await say(p, "And now?");
  await expect(turns(p).nth(1).locator(".msg.agent")).toHaveText("r2");
  await p.getByRole("navigation", { name: "Breadcrumbs" }).getByRole("button", { name: "Root", exact: true }).click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Root");
  await say(p, "Where am I?");
  await expect(turns(p).nth(2).locator(".msg.agent")).toHaveText("r3");
  const m = launches(fakeOf(w.dir))[0]?.messages ?? [];
  expect(m[1]).toBe("[still on #retry — Checkout retries]\n\nAnd now?");
  expect(m[2]).toContain("#root — Root");
  // The full text of the card: title, why and body.
  expect(m[0]).toContain("Checkout retries");
  expect(m[0]).toContain("Cards fail at random");
  expect(m[0], "first turn carries the card's body text").toContain("Retry two times then stop.");
});

test("20.4 a run of tool calls collapses into one line", async ({ page: p }) => {
  const call = (id: string, command: string) => ({
    event: {
      type: "assistant",
      message: { id: `m-${id}`, content: [{ type: "tool_use", id, name: "Bash", input: { command } }] },
    },
  });
  const result = (id: string, content: string) => ({
    event: { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content }] } },
  });
  const w = await project({
    roles: {
      chat: {
        replies: [
          [
            call("t1", "ls src"),
            result("t1", "cli.ts"),
            call("t2", "cat README.md"),
            result("t2", "# werk"),
            call("t3", "grep -r todo"),
            result("t3", "none"),
            ...reply("m4", "The code is tidy."),
          ],
        ],
      },
    },
  });
  await p.goto(`${w.url}/map`);
  await say(p, "Look at the code");
  const t = turns(p).nth(0);
  await expect(t.locator(".msg.agent")).toHaveText("The code is tidy.");
  const runs = t.locator('[data-role="tool-run"]');
  await expect(runs).toHaveCount(1);
  await expect(runs.locator("summary")).toContainText("grep -r todo");
  await expect(runs.locator("summary")).toContainText("3");
  await runs.locator("summary").click();
  await expect(runs.locator('[data-role="tool-call"]')).toHaveCount(3);
  await expect(runs.locator('[data-role="tool-input"]').nth(0)).toContainText("ls src");
  await expect(runs.locator('[data-role="tool-input"]').nth(1)).toContainText("cat README.md");
  await expect(runs.locator('[data-role="tool-input"]').nth(2)).toContainText("grep -r todo");
  await expect(runs.locator('[data-role="tool-output"]')).toHaveText(["cli.ts", "# werk", "none"]);
});

test("20.5 a chat request without the token starts no agent", async ({ page: p }) => {
  const w = await project({ roles: { chat: { replies: [reply("m1", "Done, three tries.")] } } }, (s) =>
    s.seed("node.added", { id: "retry", kind: "card", title: "Checkout retries", body: "Two tries.", parent: "root" }),
  );
  await p.goto(`${w.url}/map/retry`);
  const r = await fetch(`${w.url}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://evil.example" },
    body: JSON.stringify({ text: "Make it three tries", turn: "t1", card: "retry" }),
  });
  expect(r.status).toBeGreaterThanOrEqual(400);
  await p.waitForTimeout(1000);
  expect(launches(fakeOf(w.dir))).toEqual([]);
  await expect(turns(p)).toHaveCount(0);
  expect(w.werk("show", "retry")).toContain("Two tries.");
  await expect(p.locator('[data-field="body"]')).toHaveText("Two tries.");
});

test("73.1 a message from the open card streams back; request carries text, card and tab", async ({ page: p }) => {
  const full = "This card decides **live** turns. See #werk-wording.";
  const w = await project(
    {
      roles: {
        chat: {
          replies: [
            [
              start("m1"),
              open("This card decides"),
              { pause: 1500 },
              more(" **live** turns."),
              { pause: 1500 },
              more(" See #werk-wording."),
              done("m1", full),
            ],
          ],
        },
      },
    },
    (s) => {
      s.seed("node.added", {
        id: "werk-chat",
        kind: "card",
        title: "The composer sends a live agent turn",
        parent: "root",
      });
      s.seed("node.added", { id: "werk-wording", kind: "card", title: "Wording rules", parent: "root" });
    },
  );
  const bodies: string[] = [];
  p.on("request", (r) => {
    if (r.url().endsWith("/api/chat") && r.method() === "POST") bodies.push(r.postData() ?? "");
  });
  await p.goto(`${w.url}/map/werk-chat`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("The composer sends a live agent turn");
  // the conversation tab "design"
  const tab = pane(p).getByRole("tab", { name: "design" });
  const hasTab = (await tab.count()) > 0;
  if (hasTab) await tab.click();
  await say(p, "What does this card decide?");
  await expect(box(p)).toHaveValue("");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("This card decides");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("This card decides live turns. See #werk-wording.");
  await expect(turns(p).nth(0).locator(".msg.agent strong")).toHaveText("live");
  const link = turns(p).nth(0).locator('.msg.agent a[href$="/map/werk-wording"]');
  await expect(link).toHaveText("#werk-wording");
  const bodyLinkClass = await link.getAttribute("class");
  expect(bodies.length).toBe(1);
  const body = JSON.parse(bodies[0] ?? "{}");
  expect(body.text).toBe("What does this card decide?");
  expect(body.card).toBe("werk-chat");
  await link.click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Wording rules");
  expect(bodyLinkClass).not.toBeNull();
  expect(hasTab, "no conversation tab named design in the pane").toBe(true);
  expect(body.tab, "the request names no tab").toBe("design");
});

test("73.2 a pasted image travels with the message in the same request", async ({ page: p, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const w = await project({ roles: { chat: { replies: [reply("m1", "Looks right.")] } } }, (s) =>
    s.seed("node.added", { id: "visual", kind: "card", title: "Visual tests", parent: "root" }),
  );
  const bodies: string[] = [];
  p.on("request", (r) => {
    if (r.url().includes("/api/chat") && r.method() === "POST") bodies.push(r.postData() ?? "");
  });
  await p.goto(`${w.url}/map/visual`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Visual tests");
  await box(p).focus();
  // paste a 1x1 PNG through a synthetic clipboard paste event
  await box(p).evaluate((el) => {
    const bin = atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    );
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], "shot.png", { type: "image/png" }));
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await box(p).pressSequentially("Does this layout match the card?");
  await box(p).press("Enter");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("Looks right.");
  expect(bodies.length).toBe(1);
  const body = JSON.parse(bodies[0] ?? "{}");
  expect(body.text).toContain("Does this layout match the card?");
  expect(body.card).toBe("visual");
  expect(JSON.stringify(body), "the request carries the pasted image").toMatch(/image|png|base64/i);
});

test("73.3 each turn starts with the card the person looks at now", async ({ page: p }) => {
  const w = await project(
    { roles: { chat: { replies: [reply("m1", "fold reply"), reply("m2", "trace reply")] } } },
    (s) => {
      s.seed("node.added", { id: "pr-log", kind: "card", title: "The log is append-only", parent: "root" });
      s.seed("node.added", { id: "vi-prop-trace", kind: "card", title: "A mark shows its trace", parent: "root" });
    },
  );
  await p.goto(`${w.url}/map/pr-log`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("The log is append-only");
  await say(p, "Explain the fold");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("fold reply");
  await p.getByRole("navigation", { name: "Breadcrumbs" }).getByRole("button", { name: "Root", exact: true }).click();
  await p.locator('a[data-tile="vi-prop-trace"]').click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("A mark shows its trace");
  await say(p, "And this one?");
  await expect(turns(p).nth(1).locator(".msg.agent")).toHaveText("trace reply");
  const m = launches(fakeOf(w.dir))[0]?.messages ?? [];
  const first0 = (m[0] ?? "").split("\n")[0] ?? "";
  const first1 = (m[1] ?? "").split("\n")[0] ?? "";
  expect(first0).toContain("#pr-log");
  expect(first1).toContain("#vi-prop-trace");
  expect(first1).not.toContain("#pr-log");
  await expect(turns(p).locator(".msg.user")).toHaveText(["Explain the fold", "And this one?"]);
});

test("73.4 each conversation tab speaks to its own agent", async ({ page: p }) => {
  const w = await project({ roles: { chat: { replies: [reply("m1", "one"), reply("m2", "two")] } } }, (s) =>
    s.seed("node.added", { id: "werk-cli", kind: "card", title: "The command line", parent: "root" }),
  );
  await p.goto(`${w.url}/map/werk-cli`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("The command line");
  const alpha = pane(p).getByRole("tab", { name: "alpha" });
  const beta = pane(p).getByRole("tab", { name: "beta" });
  const tabs = (await alpha.count()) + (await beta.count());
  // Prompt check on whatever chat agent starts.
  await say(p, "First question");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("one");
  const args = launches(fakeOf(w.dir))[0]?.args.join("\n") ?? "";
  expect(args).toMatch(/No session story/);
  expect(args).toMatch(/Do not name source files, functions/);
  expect(tabs, "the pane has no conversation tabs alpha and beta").toBe(2);
});

test("73.5 a note sent to the note route appears in the card's thread", async ({ page: p, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const w = await project({ roles: {} }, (s) =>
    s.seed("node.added", {
      id: "werk-chat",
      kind: "card",
      title: "The composer sends a live agent turn",
      parent: "root",
    }),
  );
  const noteRequests: string[] = [];
  p.on("request", (r) => {
    if (r.url().includes("/api/notes")) noteRequests.push(r.url());
  });
  await p.goto(`${w.url}/map`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Root");
  const logFile = join(w.dir, ".werk", "log.jsonl");
  const before = readFileSync(logFile, "utf8").split("\n").filter(Boolean).length;
  // A client outside the browser: it reads the page token from the served page, as a script would.
  const html = await (await fetch(`${w.url}/map`)).text();
  const token = /name="werk-token" content="([^"]+)"/.exec(html)?.[1] ?? "";
  const r = await fetch(`${w.url}/api/notes`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-werk-token": token },
    body: JSON.stringify({ id: "werk-chat", text: "check the stdin path" }),
  });
  expect(r.status).toBe(200);
  const after = readFileSync(logFile, "utf8").split("\n").filter(Boolean);
  expect(after.length).toBe(before + 1);
  const ev = JSON.parse(after.at(-1) ?? "{}");
  expect(ev.type).toBe("note.added");
  expect(ev.payload.id).toBe("werk-chat");
  await p.locator('a[data-tile="werk-chat"]').click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("The composer sends a live agent turn");
  await expect(p.getByText("check the stdin path", { exact: true })).toHaveCount(1);
  expect(noteRequests).toEqual([]);
  const clip = await p.evaluate(() => navigator.clipboard.readText().catch((e) => `ERR ${e}`));
  expect(clip).toBe('re #werk-chat "The composer sends a live agent turn": check the stdin path');
});
