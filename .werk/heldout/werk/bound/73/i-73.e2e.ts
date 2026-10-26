// Held-out steps 73.1–73.5: the chat pane sends a turn and the reply streams back.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, type Request, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";
import { LAUNCHES_FILE, type Step } from "../src/test/fake-script.ts";
import { logLines, send } from "./i-helpers.ts";

test.afterEach(stop);

const stream = (event: object): Step => ({ event: { type: "stream_event", event } });

/** A reply of three text parts with a pause between them, then the finished block. */
function reply(id: string, parts: string[], pause = 1500): Step[] {
  const steps: Step[] = [
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

function card(w: Pick<Werk, "seed">, id: string, title = id): void {
  w.seed("node.added", { id, kind: "card", title, parent: "root" });
}

/** The messages each chat launch of the fake agent read, from its launch record. */
function chatTurns(w: Werk): { pid: number; args: string[]; messages: unknown[] }[] {
  const file = join(w.dir, "..", "fake", LAUNCHES_FILE);
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const launches: { pid: number; args: string[]; role: string; messages: unknown[] }[] = [];
  for (const line of text.split("\n").filter(Boolean)) {
    const entry = JSON.parse(line);
    if (entry.kind === "launch") launches.push({ ...entry, messages: [] });
    else launches.findLast((l) => l.pid === entry.pid)?.messages.push(entry.message);
  }
  return launches.filter((l) => l.role === "chat");
}

const textOf = (message: unknown): string => JSON.stringify(message);

function chatRequests(p: Page): Request[] {
  const seen: Request[] = [];
  p.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/chat") seen.push(r);
  });
  return seen;
}

const pane = (p: Page) => p.getByRole("complementary", { name: "Chat" });

test("73.1 a message sent from the open card streams its reply back into the pane", async ({ page: p }) => {
  const parts = ["This card decides ", "the **composer** path, ", "see #werk-wording for words."];
  const w = await project({ roles: { chat: { replies: [reply("m1", parts)] } } });
  card(w, "werk-chat", "The composer sends a live agent turn");
  card(w, "werk-wording", "The wording card");
  const requests = chatRequests(p);
  await p.goto(`${w.url}/map`);
  await p.locator('[data-tile="werk-chat"]').click();
  await expect(p).toHaveURL(/\/map\/werk-chat$/);
  const tab = pane(p).getByRole("tab", { name: "design" });
  await expect.soft(tab, "a conversation tab named design").toHaveAttribute("aria-selected", "true");

  const composer = pane(p).getByRole("textbox", { name: "Message" });
  await composer.fill("What does this card decide?");
  await composer.press("Enter");
  await expect.poll(() => requests.length, { message: "requests to /api/chat after Enter" }).toBe(1);
  const body = JSON.parse(requests[0]?.postData() ?? "{}");
  expect.soft(body.text).toBe("What does this card decide?");
  expect.soft(JSON.stringify(body), "the request names the card").toContain("werk-chat");
  expect.soft(JSON.stringify(body), "the request names the tab").toContain("design");
  await expect(composer).toHaveValue("");

  const agent = pane(p).locator(".msg.agent");
  await expect(agent).toContainText("This card decides");
  await expect(agent).not.toContainText("for words");
  await expect(agent).toContainText("see #werk-wording for words.");
  await expect(agent.locator("strong")).toHaveText("composer");
  const link = agent.locator('a[href="/map/werk-wording"]');
  await expect(link).toHaveText("#werk-wording");
  await link.click();
  await expect(p).toHaveURL(/\/map\/werk-wording$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("The wording card");
});

test("73.2 a pasted image travels with the message in the same request", async ({ page: p, context }) => {
  const w = await project({ roles: { chat: { replies: [reply("m1", ["It ", "matches ", "the card."])] } } });
  card(w, "visual", "Visual card");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const requests = chatRequests(p);
  await p.goto(`${w.url}/map/visual`);
  const composer = pane(p).getByRole("textbox", { name: "Message" });
  await composer.focus();
  // Paste a 1×1 PNG into the composer as the browser does on a paste of an image.
  await composer.evaluate((el) => {
    const png = Uint8Array.from(
      atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
      (c) => c.charCodeAt(0),
    );
    const data = new DataTransfer();
    data.items.add(new File([png], "shot.png", { type: "image/png" }));
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await composer.pressSequentially("Does this layout match the card?");
  await composer.press("Enter");
  await expect.poll(() => requests.length, { message: "requests to /api/chat after Enter" }).toBe(1);
  const raw = requests[0]?.postData() ?? "";
  expect.soft(raw, "the request carries the image").toMatch(/image|base64|png/i);
  expect.soft(raw, "the request carries the card").toContain("visual");
  expect.soft(raw, "the request carries the tab").toMatch(/tab/);
  expect(raw).toContain("Does this layout match the card?");
  await expect(pane(p).locator(".msg.agent")).toContainText("It matches the card.");
  expect(requests).toHaveLength(1);
});

test("73.3 each turn starts with the card the person looks at now", async ({ page: p }) => {
  const w = await project({
    roles: {
      chat: {
        replies: [
          reply("m1", ["The fold ", "reads ", "the log."], 200),
          reply("m2", ["This ", "one ", "traces."], 200),
        ],
      },
    },
  });
  card(w, "pr-log", "The log card");
  card(w, "vi-prop-trace", "The trace card");
  await p.goto(`${w.url}/map/pr-log`);
  const composer = pane(p).getByRole("textbox", { name: "Message" });
  await composer.fill("Explain the fold");
  await pane(p).getByRole("button", { name: "Send" }).click();
  await expect(pane(p).locator(".msg.agent").first()).toContainText("The fold reads the log.");
  await expect.poll(() => chatTurns(w).flatMap((l) => l.messages).length).toBe(1);
  const first = textOf(chatTurns(w).flatMap((l) => l.messages)[0]);
  expect(first).toContain("Explain the fold");
  expect(first, "turn 1 input starts with #pr-log").toMatch(/"text":"#pr-log/);

  await p.goto(`${w.url}/map`);
  await p.locator('[data-tile="vi-prop-trace"]').click();
  await expect(p).toHaveURL(/\/map\/vi-prop-trace$/);
  await composer.fill("And this one?");
  await pane(p).getByRole("button", { name: "Send" }).click();
  await expect.poll(() => chatTurns(w).flatMap((l) => l.messages).length).toBe(2);
  const second = textOf(chatTurns(w).flatMap((l) => l.messages)[1]);
  expect(second).toMatch(/"text":"#vi-prop-trace/);
  expect(second).not.toMatch(/"text":"#pr-log/);
  const agents = pane(p).locator(".msg.agent");
  await expect(agents).toHaveText(["The fold reads the log.", "This one traces."]);
});

test("73.4 each conversation tab speaks to its own agent", async ({ page: p }) => {
  const w = await project({
    roles: {
      chat: { replies: [reply("m1", ["Answer ", "one", "."], 100), reply("m2", ["Answer ", "two", "."], 100)] },
    },
  });
  card(w, "werk-cli", "The command line");
  await p.goto(`${w.url}/map/werk-cli`);
  const tabs = pane(p).getByRole("tab");
  await expect(tabs.filter({ hasText: "alpha" }), "a conversation tab named alpha").toHaveCount(1);
  await expect(tabs.filter({ hasText: "beta" }), "a conversation tab named beta").toHaveCount(1);
  const composer = pane(p).getByRole("textbox", { name: "Message" });
  await tabs.filter({ hasText: "alpha" }).click();
  await composer.fill("First question");
  await pane(p).getByRole("button", { name: "Send" }).click();
  await tabs.filter({ hasText: "beta" }).click();
  await composer.fill("Second question");
  await pane(p).getByRole("button", { name: "Send" }).click();
  await expect(pane(p).locator(".msg.agent")).toContainText("Answer two.");
  const launches = chatTurns(w);
  expect(launches).toHaveLength(2);
  expect(launches.map((l) => l.messages.map(textOf).join("|"))).toEqual([
    expect.stringContaining("First question"),
    expect.stringContaining("Second question"),
  ]);
  expect(textOf(launches[0]?.messages)).not.toContain("Second question");
  expect(textOf(launches[1]?.messages)).not.toContain("First question");
  for (const launch of launches) {
    const prompt = launch.args.join("\n");
    expect(prompt).toMatch(/about its subject/i);
    expect(prompt).toMatch(/session/i);
    expect(prompt).toMatch(/file/i);
    expect(prompt).toMatch(/function/i);
    expect(prompt).toMatch(/line/i);
  }
});

test("73.5 a note sent to the note route appears in the card's thread", async ({ page: p, context }) => {
  const w = await project();
  card(w, "werk-chat", "The composer sends a live agent turn");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const noteRequests: Request[] = [];
  p.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/note")) noteRequests.push(r);
  });
  await p.goto(`${w.url}/map`);
  await expect(pane(p).getByRole("textbox", { name: "Message" })).toHaveValue("");
  const html = (await send(w.url, "/map")).body;
  const token = /name="werk-token" content="([^"]+)"/.exec(html)?.[1] ?? "";
  const before = logLines(w).length;
  const result = await send(w.url, "/api/notes", {
    method: "POST",
    token,
    body: JSON.stringify({ id: "werk-chat", text: "check the stdin path" }),
  });
  expect(result.status).toBe(200);
  const added = logLines(w).slice(before);
  expect(added).toHaveLength(1);
  expect(added[0]?.type).toBe("note.added");
  expect(added[0]?.payload.id).toBe("werk-chat");

  await expect
    .soft.poll(() => p.evaluate(() => navigator.clipboard.readText()), { message: "the clipboard line" })
    .toBe('re #werk-chat "The composer sends a live agent turn": check the stdin path');

  await p.locator('[data-tile="werk-chat"]').click();
  await expect(p).toHaveURL(/\/map\/werk-chat$/);
  const notes = p.locator('[data-section="thread"] [data-entry="note"]').filter({ hasText: "check the stdin path" });
  await expect(notes).toHaveCount(1);
  expect(noteRequests).toHaveLength(0);
});
