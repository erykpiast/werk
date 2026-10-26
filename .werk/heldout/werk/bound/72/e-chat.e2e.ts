// Held-out steps 73.x: the chat pane sends a turn from the open card and streams the reply back.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, type Page, type Request, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

const stream = (event: object) => ({ event: { type: "stream_event", event } });

/** A scripted reply in parts, with a pause between parts. */
function reply(id: string, parts: string[], pause = 0): object[] {
  const steps: object[] = [
    stream({ type: "message_start", message: { id } }),
    stream({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
  ];
  parts.forEach((part, i) => {
    if (i > 0 && pause > 0) steps.push({ pause });
    steps.push(stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: part } }));
  });
  steps.push({ event: { type: "assistant", message: { id, content: [{ type: "text", text: parts.join("") }] } } });
  return steps;
}

type Launch = { pid: number; args: string[]; role: string; messages: unknown[] };

function launches(w: Werk): Launch[] {
  let text = "";
  try {
    text = readFileSync(join(dirname(w.dir), "fake", "launches.jsonl"), "utf8");
  } catch {
    return [];
  }
  const out: Launch[] = [];
  for (const line of text.split("\n").filter(Boolean)) {
    const e = JSON.parse(line);
    if (e.kind === "launch") out.push({ pid: e.pid, args: e.args, role: e.role, messages: [] });
    else out.findLast((l) => l.pid === e.pid)?.messages.push(e.message);
  }
  return out;
}

const turnText = (m: unknown) =>
  ((m as { message?: { content?: { text?: string }[] } }).message?.content ?? []).map((c) => c.text ?? "").join("");

function card(w: Pick<Werk, "seed">, id: string, title = id): void {
  w.seed("node.added", { id, kind: "card", title, parent: "root", status: "decided", who: "me" });
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
        chat: { replies: [reply("m1", ["It decides ", "that **turns** stream ", "and links #werk-wording."], 2000)] },
      },
    },
    (d) => {
      card(d, "werk-chat", "The composer sends a live agent turn");
      card(d, "werk-wording", "Wording");
    },
  );
  const sent = chatRequests(p);
  await p.goto(`${w.url}/map/werk-chat`);
  await expect(pane(p)).toBeVisible();
  // The conversation tab "design" is the active tab.
  await expect.soft(pane(p).getByRole("tab", { name: "design", selected: true })).toBeVisible({ timeout: 3000 });
  await composer(p).fill("What does this card decide?");
  await composer(p).press("Enter");
  await expect.poll(() => sent.length).toBe(1);
  const body = sent[0]?.postDataJSON() as Record<string, unknown>;
  expect(JSON.stringify(body)).toContain("What does this card decide?");
  expect(JSON.stringify(body)).toContain("werk-chat");
  expect(JSON.stringify(body)).toContain("design");
  await expect(composer(p)).toHaveValue("");
  const agent = pane(p).locator(".msg.agent");
  await expect(agent).toContainText("It decides");
  await expect(agent).not.toContainText("#werk-wording");
  await expect(agent.locator("strong")).toHaveText("turns");
  const link = agent.locator('a[href="/map/werk-wording"]');
  await expect(link).toHaveText("#werk-wording");
  await link.click();
  await expect(p).toHaveURL(/\/map\/werk-wording$/);
});

test("73.2 a pasted image travels with the message in the same request", async ({ page: p, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const w = await project({ roles: { chat: { replies: [reply("m1", ["The layout ", "matches."])] } } }, (d) =>
    card(d, "visual", "Visual"),
  );
  const sent = chatRequests(p);
  await p.goto(`${w.url}/map/visual`);
  await composer(p).focus();
  // Paste one PNG through a paste event with an image file on its clipboard data.
  await composer(p).evaluate((el) => {
    const png = Uint8Array.from(
      atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
      (c) => c.charCodeAt(0),
    );
    const data = new DataTransfer();
    data.items.add(new File([png], "shot.png", { type: "image/png" }));
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await composer(p).pressSequentially("Does this layout match the card?");
  await composer(p).press("Enter");
  await expect.poll(() => sent.length).toBe(1);
  const raw = sent[0]?.postData() ?? "";
  expect(raw).toContain("Does this layout match the card?");
  expect(raw).toMatch(/image\/png|iVBORw0KGgo/);
  expect(raw).toContain("visual");
  await expect(pane(p).locator(".msg.agent")).toContainText("The layout matches.");
});

test("73.3 each turn starts with the card the person looks at now", async ({ page: p }) => {
  const w = await project(
    {
      roles: {
        chat: { replies: [reply("m1", ["The fold reads the log."]), reply("m2", ["This one traces a mark."])] },
      },
    },
    (d) => {
      card(d, "pr-log", "The log");
      card(d, "vi-prop-trace", "The trace");
    },
  );
  await p.goto(`${w.url}/map/pr-log`);
  await composer(p).fill("Explain the fold");
  await pane(p).getByRole("button", { name: "Send" }).click();
  await expect(pane(p).locator(".msg.agent")).toContainText("The fold reads the log.");
  const first = () =>
    launches(w)
      .flatMap((l) => l.messages)
      .map(turnText);
  expect(first()[0]?.startsWith("#pr-log")).toBe(true);
  await p.goto(`${w.url}/map`);
  await p.locator('a[data-tile="vi-prop-trace"]').click();
  await composer(p).fill("And this one?");
  await pane(p).getByRole("button", { name: "Send" }).click();
  await expect(pane(p).locator(".msg.agent").nth(1)).toContainText("This one traces a mark.");
  const second = first()[1] ?? "";
  expect(second.startsWith("#vi-prop-trace")).toBe(true);
  expect(second.startsWith("#pr-log")).toBe(false);
});

test("73.4 each conversation tab speaks to its own agent", async ({ page: p }) => {
  const w = await project({ roles: { chat: { replies: [reply("m1", ["One."]), reply("m2", ["Two."])] } } }, (d) =>
    card(d, "werk-cli", "The command line"),
  );
  await p.goto(`${w.url}/map/werk-cli`);
  const tab = (name: string) => pane(p).getByRole("tab", { name });
  await expect(tab("alpha")).toBeVisible({ timeout: 3000 });
  await expect(tab("beta")).toBeVisible();
  await tab("alpha").click();
  await composer(p).fill("First question");
  await pane(p).getByRole("button", { name: "Send" }).click();
  await tab("beta").click();
  await composer(p).fill("Second question");
  await pane(p).getByRole("button", { name: "Send" }).click();
  const chats = launches(w).filter((l) => l.role === "chat");
  expect(chats).toHaveLength(2);
  const prompt = chats.map((l) => l.args.join(" ")).join("\n");
  expect(prompt).toMatch(/subject/);
  expect(prompt).toMatch(/file|function|line/);
});

test("73.5 a note sent to the note route appears in the card's thread", async ({ page: p, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const w = await project(undefined, (d) => card(d, "werk-chat", "The composer sends a live agent turn"));
  const log = join(w.dir, ".werk", "log.jsonl");
  const lines = () => readFileSync(log, "utf8").split("\n").filter(Boolean);
  const before = lines().length;
  const noteRequests: string[] = [];
  p.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/notes")) noteRequests.push(r.url());
  });
  await p.goto(`${w.url}/map`);
  await expect(composer(p)).toHaveValue("");
  // The client outside the browser reads the page's token, as any local client of the server can.
  const page = await (await fetch(`${w.url}/map`)).text();
  const token = /name="werk-token" content="([^"]+)"/.exec(page)?.[1] ?? "";
  const res = await fetch(`${w.url}/api/notes`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-werk-token": token },
    body: JSON.stringify({ id: "werk-chat", text: "check the stdin path" }),
  });
  expect(res.status).toBe(200);
  const added = lines()
    .slice(before)
    .map((l) => JSON.parse(l));
  expect(added).toHaveLength(1);
  expect(added[0].type).toBe("note.added");
  expect(added[0].payload.id).toBe("werk-chat");
  const clip = await p.evaluate(() => navigator.clipboard.readText());
  expect.soft(clip).toBe('re #werk-chat "The composer sends a live agent turn": check the stdin path');
  await p.locator('a[data-tile="werk-chat"]').click();
  const notes = p.locator('[data-section="thread"] [data-entry="note"]').filter({ hasText: "check the stdin path" });
  await expect(notes).toHaveCount(1);
  expect(noteRequests).toHaveLength(0);
});
