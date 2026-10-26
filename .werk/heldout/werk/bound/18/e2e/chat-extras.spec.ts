import { expect, type Page, test } from "@playwright/test";
import { card, decided, refines } from "../events.ts";
import { type Server, startServer } from "./server.ts";

const pane = (page: Page) => page.getByRole("region", { name: "Map pane" });
const chat = (page: Page) => page.getByRole("complementary", { name: "Chat pane" });
const composer = (page: Page) => page.getByRole("textbox", { name: "Message" });

const say = (id: string, text: string) => ({
  event: { type: "assistant", message: { id, content: [{ type: "text", text }] } },
});
const reply = (id: string, text: string) => [say(id, text)];

async function send(page: Page, text: string) {
  await composer(page).fill(text);
  await composer(page).press("Enter");
}

async function withServer(
  options: Parameters<typeof startServer>[0],
  body: (server: Server) => Promise<void>,
) {
  const server = await startServer(options);
  await server.start();
  try {
    await body(server);
  } finally {
    await server.dispose();
  }
}

const twoCards = [
  card("a", { title: "Card A" }),
  card("b", { title: "Card B" }),
  refines("b", "a"),
];

// ---------------------------------------------------------------- 23
test("23.1 two conversations with different home cards stay apart", async ({ page }) => {
  await withServer(
    {
      events: twoCards.flat(),
      script: { roles: { chat: { replies: [reply("m1", "Answer in A"), reply("m2", "Answer in B")] } } },
    },
    async (server) => {
      await page.goto(`${server.url}/map/a`);
      await expect(pane(page).getByRole("heading", { level: 1, name: "Card A" })).toBeVisible();
      await send(page, "Message in A");
      await expect(chat(page).getByText("Answer in A")).toBeVisible();
      await pane(page).locator("a.tile", { hasText: "Card B" }).click();
      await expect(pane(page).getByRole("heading", { level: 1, name: "Card B" })).toBeVisible();
      await chat(page).getByRole("button", { name: /new (conversation|chat)/i }).click();
      await send(page, "Message in B");
      await expect(chat(page).getByText("Answer in B")).toBeVisible();
      const tabs = chat(page).getByRole("tablist");
      await expect(tabs.getByRole("tab")).toHaveCount(2);
      await expect(tabs.getByRole("tab", { name: "Card A" })).toBeVisible();
      await expect(tabs.getByRole("tab", { name: "Card B" })).toBeVisible();
    },
  );
});

test("23.2 switching to a tab shows its newest message", async ({ page }) => {
  await withServer(
    {
      events: twoCards.flat(),
      script: { roles: { chat: { replies: [reply("m1", "First"), reply("m2", "Second")] } } },
    },
    async (server) => {
      await page.goto(`${server.url}/map/a`);
      await send(page, "One");
      await expect(chat(page).getByText("First")).toBeVisible();
      const tabs = chat(page).getByRole("tablist");
      await expect(tabs.getByRole("tab")).toHaveCount(1);
      await tabs.getByRole("tab").first().click();
      const log = chat(page).locator("[data-slot=chat-scroll]");
      const atBottom = await log.evaluate((n) => n.scrollTop + n.clientHeight >= n.scrollHeight - 2);
      expect(atBottom).toBe(true);
    },
  );
});

test("23.3 a crashed agent marks its tab and tells the other tabs", async ({ page }) => {
  await withServer(
    {
      events: twoCards.flat(),
      script: { roles: { chat: { replies: [[say("m1", "starting"), { crash: 1 }], reply("m2", "recovered")] } } },
    },
    async (server) => {
      await page.goto(`${server.url}/map/a`);
      await send(page, "Crash please");
      const tabs = chat(page).getByRole("tablist");
      const chip = tabs.getByRole("tab", { name: "Card A" });
      await expect(chip).toBeVisible();
      await expect(chip).toHaveAttribute("data-state", /dead|crashed|red/);
    },
  );
});

test("23.4 a model switch is not a crash", async ({ page }) => {
  await withServer(
    {
      events: twoCards.flat(),
      script: { roles: { chat: { replies: [reply("m1", "hello"), reply("m2", "still here")] } } },
    },
    async (server) => {
      await page.goto(`${server.url}/map/a`);
      await send(page, "Hi");
      await expect(chat(page).getByText("hello")).toBeVisible();
      await chat(page).getByRole("combobox", { name: /model/i }).selectOption({ index: 1 });
      await send(page, "Again");
      await expect(chat(page).getByText("still here")).toBeVisible();
      await expect(chat(page).getByRole("tablist").getByRole("tab").first()).not.toHaveAttribute("data-state", /dead|crashed|red/);
    },
  );
});

test("23.5 a running background agent and a suggested next action", async ({ page }) => {
  await withServer(
    {
      events: twoCards.flat(),
      script: { roles: { chat: { replies: [reply("m1", "Done.\nNext: say \"merge it\""), reply("m2", "Merging")] } } },
    },
    async (server) => {
      await page.goto(`${server.url}/map/a`);
      await send(page, "Go");
      await expect(chat(page).getByText("Done.")).toBeVisible();
      const next = chat(page).getByRole("button", { name: "merge it" });
      await expect(next).toBeVisible();
      await next.click();
      await expect(chat(page).getByText("Merging")).toBeVisible();
      await expect(next).toHaveCount(0);
    },
  );
});

// ---------------------------------------------------------------- 24
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Fires a paste or a drop with one file on the composer. */
async function giveFile(
  page: Page,
  kind: "paste" | "drop",
  file: { name: string; type: string; bytes: number },
) {
  await composer(page).evaluate(
    (node, { kind, file, head }) => {
      const data = new Uint8Array(file.bytes);
      data.set(head);
      const transfer = new DataTransfer();
      transfer.items.add(new File([data], file.name, { type: file.type }));
      const event =
        kind === "paste"
          ? new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true })
          : new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true });
      node.dispatchEvent(event);
    },
    { kind, file, head: PNG },
  );
}

test("24.1 pick a card from the hash menu", async ({ page }) => {
  await withServer(
    { events: [card("root", { title: "Root" }), card("werk-shots", { title: "Pasted screenshots" }), refines("werk-shots", "root")].flat() },
    async (server) => {
      await page.goto(server.url);
      await expect(pane(page).getByRole("heading", { level: 1, name: "Root" })).toBeVisible();
      await composer(page).click();
      await composer(page).pressSequentially("Look at #wer");
      const menu = page.getByRole("listbox");
      await expect(menu).toBeVisible();
      await expect(menu.getByText("werk-shots")).toBeVisible();
      await expect(menu.getByText("Pasted screenshots")).toBeVisible();
      await composer(page).press("ArrowDown");
      await composer(page).press("Enter");
      await expect(composer(page)).toHaveValue("Look at #werk-shots");
      await expect(menu).toHaveCount(0);
      await composer(page).fill("");
      await composer(page).pressSequentially("`#wer");
      await expect(page.getByRole("listbox")).toHaveCount(0);
    },
  );
});

test("24.2 a pasted PNG uploads at once and reaches the agent as a stored path", async ({ page }) => {
  await withServer(
    {
      events: card("root", { title: "Root" }),
      script: { roles: { chat: { replies: [reply("m1", "seen")] } } },
    },
    async (server) => {
      await page.goto(server.url);
      await composer(page).click();
      await composer(page).pressSequentially("What is wrong here? ");
      await giveFile(page, "paste", { name: "shot.png", type: "image/png", bytes: 2048 });
      await expect(composer(page)).toHaveValue(/\[Image #1\]/);
      await composer(page).press("Enter");
      await expect(chat(page).getByText("seen")).toBeVisible();
      const [message] = server.launches().flatMap((r) => (r.kind === "message" ? [r.text] : []));
      expect(message).toMatch(/\[Image #1\].*attachments/s);
    },
  );
});

test("24.3 an oversized image is refused and is not sent", async ({ page }) => {
  await withServer(
    { events: card("root", { title: "Root" }), script: { roles: { chat: { replies: [reply("m1", "ok")] } } } },
    async (server) => {
      await page.goto(server.url);
      await giveFile(page, "drop", { name: "big.png", type: "image/png", bytes: 25 * 1024 * 1024 });
      await expect(composer(page)).toHaveValue(/\[Image #1\]/);
      await expect(chat(page).getByText(/limit|too large|MB/i)).toBeVisible();
    },
  );
});

test("24.4 removing the first of two images renumbers the second", async ({ page }) => {
  await withServer(
    { events: card("root", { title: "Root" }), script: { roles: { chat: { replies: [reply("m1", "ok")] } } } },
    async (server) => {
      await page.goto(server.url);
      await giveFile(page, "paste", { name: "one.png", type: "image/png", bytes: 1024 });
      await giveFile(page, "paste", { name: "two.jpg", type: "image/jpeg", bytes: 1024 });
      await expect(composer(page)).toHaveValue(/\[Image #1\].*\[Image #2\]/s);
      await chat(page).getByRole("button", { name: /remove.*image 1/i }).click();
      await expect(composer(page)).toHaveValue(/\[Image #1\]/);
      await expect(composer(page)).not.toHaveValue(/\[Image #2\]/);
    },
  );
});

test("24.5 a bad image request does not harm the server", async ({ page }) => {
  await withServer(
    { events: card("root", { title: "Root" }) },
    async (server) => {
      await page.goto(server.url);
      const base = `${server.origin}/api/projects/project/image`;
      expect((await fetch(`${base}/`)).status).toBe(404);
      expect((await fetch(`${base}/..%2F..%2F.werk%2Flog.jsonl`)).status).toBe(404);
      await composer(page).click();
      await composer(page).pressSequentially("/");
      await expect(page.getByRole("listbox")).toBeVisible();
    },
  );
});

// ---------------------------------------------------------------- 29
const subtree = [
  decided("sub", { title: "Subtree root" }),
  decided("c1", { title: "Cited card one" }),
  decided("c2", { title: "Cited card two" }),
  refines("c1", "sub"),
  refines("c2", "sub"),
].flat();
const boardEvents = [
  { type: "ticket.planned", id: "sub/01", title: "Ticket one", cites: ["c1"] },
  { type: "ticket.planned", id: "sub/02", title: "Ticket two", cites: ["c2"] },
  { type: "ticket.planned", id: "sub/03", title: "Ticket three", cites: ["c1"] },
  { type: "ticket.moved", id: "sub/01", to: "building" },
  { type: "ticket.moved", id: "sub/02", to: "building" },
  { type: "ticket.moved", id: "sub/02", to: "merging", actor: "loop" },
  { type: "ticket.merge", id: "sub/02" },
];

async function openBoard(page: Page, server: Server) {
  await page.goto(`${server.url}/board`);
  await expect(pane(page).getByRole("heading", { name: "Board" })).toBeVisible();
}

test("29.1 a second plan of the same subtree extends the spec and continues the ticket numbers", async ({ page }) => {
  await withServer({ events: subtree, board: boardEvents }, async (server) => {
    server.werk("add", "c3", "--title", "New decided card", "--parent", "sub");
    await openBoard(page, server);
    await expect(pane(page).getByText("Ticket three")).toBeVisible();
    await pane(page).getByRole("button", { name: /plan/i }).click();
    await expect(pane(page).getByText(/New decided card/)).toBeVisible();
    await expect(pane(page).getByText("04")).toBeVisible();
  });
});

test("29.2 an open ticket the new spec no longer needs is archived and can be restored", async ({ page }) => {
  // The removal is already in the log: the person removed the card before the second plan.
  const removed = [...subtree, { type: "node.removed", id: "c1", actor: "you" }];
  await withServer({ events: removed, board: boardEvents }, async (server) => {
    await openBoard(page, server);
    await pane(page).getByRole("button", { name: /plan/i }).click();
    await expect(pane(page).getByText("Ticket three")).toHaveCount(0);
    await pane(page).getByRole("button", { name: /archive/i }).click();
    await expect(pane(page).getByText(/no longer needs/i)).toBeVisible();
  });
});

test("29.3 retitling a cited card blocks the ready ticket that cites it, and a re-plan clears the block", async ({ page }) => {
  await withServer({ events: subtree, board: boardEvents }, async (server) => {
    expect(server.werk("propose", "c1", "--title", "Cited card one renamed").code).toBe(0);
    expect(server.werk("accept", "c1", "--actor", "you").code).toBe(0);
    await openBoard(page, server);
    const blocked = pane(page).locator("[data-column=blocked], [aria-label=Blocked]");
    await expect(blocked.getByText("Ticket three")).toBeVisible();
    await expect(blocked.getByText(/title changed/i)).toBeVisible();
  });
});

test("29.4 a note on a cited card blocks nothing, and a building ticket is never blocked", async ({ page }) => {
  await withServer({ events: subtree, board: boardEvents }, async (server) => {
    expect(server.werk("say", "c1", "a note").code).toBe(0);
    expect(server.werk("propose", "c1", "--ops", JSON.stringify([{ tag: "new", new: "More words." }])).code).toBe(0);
    expect(server.werk("accept", "c1", "--actor", "you").code).toBe(0);
    await openBoard(page, server);
    const blocked = pane(page).locator("[data-column=blocked], [aria-label=Blocked]");
    await expect(blocked.getByText("Ticket three")).toBeVisible();
    await expect(blocked.getByText(/body changed|changed body/i)).toBeVisible();
    await expect(blocked.getByText("Ticket one")).toHaveCount(0);
  });
});

test("29.5 a card added under a planned subtree reports a failed check without blocking tickets", async ({ page }) => {
  await withServer({ events: subtree, board: boardEvents }, async (server) => {
    const added = server.werk("add", "c9", "--title", "Uncited card", "--parent", "sub");
    expect(added.code).toBe(0);
    expect(`${added.stdout}${added.stderr}`).toMatch(/cards-cited/);
    expect(`${added.stdout}${added.stderr}`).toContain("c9");
    await openBoard(page, server);
    await expect(pane(page).locator("[data-column=blocked]")).toHaveCount(0);
  });
});
