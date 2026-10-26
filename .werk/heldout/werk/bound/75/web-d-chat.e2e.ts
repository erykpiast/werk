// Held-out steps 73.1 to 73.5: the chat pane, its conversation tabs, and the note route.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, type Request, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

const stream = (event: object) => ({ event: { type: "stream_event", event } });

/** A scripted reply that streams `parts` as deltas with a pause between each, then the finished block. */
function reply(id: string, parts: string[], pause = 1500): object[] {
  const steps: object[] = [
    stream({ type: "message_start", message: { id } }),
    stream({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
  ];
  parts.forEach((part, i) => {
    if (i > 0) steps.push({ pause });
    steps.push(stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: part } }));
  });
  steps.push({ event: { type: "assistant", message: { id, content: [{ type: "text", text: parts.join("") }] } } });
  return steps;
}

function card(w: Omit<Werk, "url">, id: string, title: string, body?: string): void {
  w.seed("node.added", { id, kind: "card", title, parent: "root", ...(body ? { body } : {}) });
}

type Launch =
  | { kind: "launch"; pid: number; args: string[]; role: string }
  | { kind: "message"; pid: number; message: unknown };

function launches(w: Werk): Launch[] {
  const file = join(w.dir, "..", "fake", "launches.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Launch);
}

function messageText(message: unknown): string {
  const m = message as { message?: { content?: { type: string; text?: string }[] } };
  return (m.message?.content ?? []).map((c) => c.text ?? "").join("");
}

const pane = (p: Page) => p.getByRole("complementary", { name: "Chat" });
const composer = (p: Page) => pane(p).getByRole("textbox", { name: "Message" });

function chatRequests(p: Page): Request[] {
  const seen: Request[] = [];
  p.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname.startsWith("/api/chat")) seen.push(r);
  });
  return seen;
}

test("73.1 a message sent from the open card streams its reply back into the pane", async ({ page: p }) => {
  const w = await project(
    {
      roles: {
        chat: {
          replies: [reply("msg-1", ["This card decides **retries**. ", "See #werk-wording ", "for the words."])],
        },
      },
    },
    (down) => {
      card(down, "werk-chat", "The composer sends a live agent turn");
      card(down, "werk-wording", "The wording of the chat");
    },
  );
  const sent = chatRequests(p);
  await p.goto(`${w.url}/map`);
  await p.locator('a[data-tile="werk-chat"]').click();
  await expect(p).toHaveURL(/\/map\/werk-chat$/);

  // Given the conversation tab "design" is the active tab.
  const tab = pane(p).getByRole("tab", { name: "design" });
  await expect(tab, "the chat pane has a conversation tab named design").toHaveCount(1, { timeout: 3000 });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");

  await composer(p).fill("What does this card decide?");
  await composer(p).press("Enter");
  await expect.poll(() => sent.length, { timeout: 3000 }).toBe(1);
  const body = sent[0]?.postData() ?? "";
  expect(body).toContain("What does this card decide?");
  expect(body).toContain("werk-chat");
  expect(body).toContain("design");
  await expect(composer(p)).toHaveValue("");

  const agent = pane(p).locator(".msg.agent");
  await expect(agent).toContainText("This card decides");
  await expect(agent).not.toContainText("for the words.");
  await expect(agent).toContainText("for the words.", { timeout: 10000 });
  await expect(agent.locator("strong")).toHaveText("retries");
  const link = agent.locator('a[href="/map/werk-wording"]');
  await expect(link).toHaveClass(/ref/);
  await expect(link.locator("code")).toHaveText("#werk-wording");
  await link.click();
  await expect(p).toHaveURL(/\/map\/werk-wording$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("The wording of the chat");
});

test("73.2 a pasted image travels with the message in the same request", async ({ page: p, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const w = await project(
    { roles: { chat: { replies: [reply("msg-1", ["It matches ", "the card."], 300)] } } },
    (down) => {
      card(down, "visual", "The layout has two panes");
    },
  );
  const sent = chatRequests(p);
  await p.goto(`${w.url}/map/visual`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("The layout has two panes");

  // Paste a 1x1 PNG into the composer with a synthetic paste event that carries an image file.
  await composer(p).focus();
  await composer(p).evaluate(async (el) => {
    const png = Uint8Array.from(
      atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
      (c) => c.charCodeAt(0),
    );
    const data = new DataTransfer();
    data.items.add(new File([png], "layout.png", { type: "image/png" }));
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await composer(p).pressSequentially("Does this layout match the card?");
  await composer(p).press("Enter");

  await expect.poll(() => sent.length, { timeout: 3000 }).toBe(1);
  await p.waitForTimeout(500);
  expect(sent.length).toBe(1);
  const req = sent[0] as Request;
  const body = req.postDataBuffer()?.toString("latin1") ?? "";
  expect(body).toContain("Does this layout match the card?");
  expect(body, "the request carries the image").toMatch(/image\/png|iVBORw0KGgo|\x89PNG/);
  expect(body).toContain("visual");
  expect(body, "the request names the active tab").toMatch(/"tab"|tab=/);
  await expect(pane(p).locator(".msg.agent")).toContainText("It matches the card.");
});

test("73.3 each turn starts with the card the person looks at now", async ({ page: p }) => {
  const w = await project(
    {
      roles: {
        chat: {
          replies: [
            reply("msg-1", ["The fold ", "reads the log."], 200),
            reply("msg-2", ["This one ", "traces props."], 200),
          ],
        },
      },
    },
    (down) => {
      card(down, "pr-log", "The log is append-only");
      card(down, "vi-prop-trace", "A proposal shows its trace");
    },
  );
  await p.goto(`${w.url}/map`);
  await p.locator('a[data-tile="pr-log"]').click();
  await expect(p).toHaveURL(/\/map\/pr-log$/);
  await composer(p).fill("Explain the fold");
  await pane(p).getByRole("button", { name: "Send" }).click();
  await expect(pane(p).locator(".msg.agent")).toContainText("The fold reads the log.", { timeout: 10000 });
  const first = launches(w).filter((e) => e.kind === "message");
  expect(first.length).toBe(1);
  const firstText = messageText(first[0]?.message);
  console.log(`73.3 first turn input: ${JSON.stringify(firstText)}`);

  // Back to the root card through the card's own refines link, with no page load.
  await p.locator('[data-section="refines"] a[href="/map/root"]').first().click();
  await expect(p).toHaveURL(/\/map\/root$/);
  await p.locator('a[data-tile="vi-prop-trace"]').click();
  await expect(p).toHaveURL(/\/map\/vi-prop-trace$/);
  await composer(p).fill("And this one?");
  await pane(p).getByRole("button", { name: "Send" }).click();
  await expect(pane(p).locator(".msg.agent").nth(1)).toContainText("This one traces props.", { timeout: 10000 });
  const msgs = launches(w).filter((e) => e.kind === "message");
  const secondText = messageText(msgs[1]?.message);
  console.log(`73.3 second turn input: ${JSON.stringify(secondText)}`);

  // Both replies in the order sent.
  const replies = pane(p).locator(".msg.agent");
  await expect(replies).toHaveCount(2);
  await expect(replies.nth(0)).toContainText("The fold reads the log.");
  await expect(replies.nth(1)).toContainText("This one traces props.");

  expect.soft(firstText.trimStart(), "first turn input starts with #pr-log").toMatch(/^#pr-log\b/);
  expect.soft(secondText.trimStart(), "second turn input starts with #vi-prop-trace").toMatch(/^#vi-prop-trace\b/);
  expect.soft(secondText.trimStart()).not.toMatch(/^#pr-log\b/);
});

test("73.4 each conversation tab speaks to its own agent", async ({ page: p }) => {
  const w = await project(
    {
      roles: {
        chat: {
          replies: [reply("msg-a", ["Answer to ", "first."], 200), reply("msg-b", ["Answer to ", "second."], 200)],
        },
      },
    },
    (down) => card(down, "werk-cli", "The command line is the agent's tool"),
  );
  await p.goto(`${w.url}/map/werk-cli`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("The command line is the agent's tool");

  const alpha = pane(p).getByRole("tab", { name: "alpha" });
  const beta = pane(p).getByRole("tab", { name: "beta" });
  // The map opens with two conversation tabs; the person may need to create them, so try a "new tab" control first.
  const newTab = pane(p).getByRole("button", { name: /new (conversation|tab)|\+/i });
  if ((await alpha.count()) === 0 && (await newTab.count()) > 0) {
    await newTab.first().click();
    await newTab.first().click();
  }
  await expect(alpha, "the chat pane has a conversation tab alpha").toHaveCount(1, { timeout: 3000 });
  await expect(beta, "the chat pane has a conversation tab beta").toHaveCount(1);

  await alpha.click();
  await composer(p).fill("First question");
  await pane(p).getByRole("button", { name: "Send" }).click();
  await beta.click();
  await composer(p).fill("Second question");
  await pane(p).getByRole("button", { name: "Send" }).click();
  await expect(pane(p).locator(".msg.agent")).toContainText("Answer to second.", { timeout: 10000 });

  const all = launches(w);
  const launchesOf = all.filter((e) => e.kind === "launch");
  expect(launchesOf.length).toBe(2);
  for (const l of launchesOf) {
    const msgs = all
      .filter((e) => e.kind === "message" && e.pid === l.pid)
      .map((e) => messageText((e as { message: unknown }).message));
    expect(msgs.length).toBe(1);
    const prompt = (l as { args: string[] }).args.join("\n");
    expect(prompt).toMatch(/subject/i);
    expect(prompt).toMatch(/session/i);
    expect(prompt).toMatch(/file/i);
    expect(prompt).toMatch(/function/i);
    expect(prompt).toMatch(/line/i);
  }
  const texts = all.filter((e) => e.kind === "message").map((e) => messageText((e as { message: unknown }).message));
  expect(texts.some((t) => t.includes("First question"))).toBe(true);
  expect(texts.some((t) => t.includes("Second question"))).toBe(true);
  await alpha.click();
  await expect(pane(p).locator(".msg.agent")).not.toContainText("Answer to second.");
});

test("73.5 a note sent to the note route appears in the card's thread", async ({ page: p, request }) => {
  const w = await project(undefined, (down) => card(down, "werk-chat", "The composer sends a live agent turn"));
  const log = join(w.dir, ".werk", "log.jsonl");
  const before = readFileSync(log, "utf8").split("\n").filter(Boolean).length;

  // A client outside the browser: it reads the token from the page head, then posts the note.
  const html = await (await request.get(`${w.url}/map`)).text();
  const token = /<meta name="werk-token" content="([^"]+)"/.exec(html)?.[1] ?? "";
  expect(token).not.toBe("");
  const answer = await request.post(`${w.url}/api/notes`, {
    headers: { "content-type": "application/json", "x-werk-token": token },
    data: { id: "werk-chat", text: "check the stdin path" },
  });
  expect(answer.status()).toBe(200);

  const lines = readFileSync(log, "utf8").split("\n").filter(Boolean);
  const added = lines.slice(before).map((l) => JSON.parse(l) as { type: string; payload: { id?: string } });
  const notes = added.filter((e) => e.type === "note.added");
  expect(notes.length).toBe(1);
  expect(notes[0]?.payload.id).toBe("werk-chat");

  const noteRequests: string[] = [];
  p.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/notes")) noteRequests.push(r.url());
  });
  await p.goto(`${w.url}/map`);
  await p.locator('a[data-tile="werk-chat"]').click();
  await expect(p).toHaveURL(/\/map\/werk-chat$/);
  const thread = p.locator('[data-section="thread"] [data-entry="note"]').filter({ hasText: "check the stdin path" });
  await expect(thread).toHaveCount(1);
  expect(noteRequests).toEqual([]);

  // The clipboard (the system clipboard of this machine) holds the reference line.
  const clip = process.platform === "darwin" ? execFileSync("pbpaste", { encoding: "utf8" }) : "";
  expect(clip).toContain('re #werk-chat "The composer sends a live agent turn": check the stdin path');
});
