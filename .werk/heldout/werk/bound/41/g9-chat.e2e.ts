import { expect, type Page, test } from "@playwright/test";
import { project, stop } from "./g9-project.ts";

test.afterEach(stop);

const stream = (event: object) => ({ event: { type: "stream_event", event } });
const init = (session: string) => ({ event: { type: "system", subtype: "init", session_id: session } });
const open = (text: string) => stream({ type: "content_block_start", index: 0, content_block: { type: "text", text } });
const startMsg = (id: string) => stream({ type: "message_start", message: { id } });
const done = (id: string, text: string, used = 0) => ({
  event: {
    type: "assistant",
    message: { id, content: [{ type: "text", text }], usage: { input_tokens: used, output_tokens: 0 } },
  },
});
/** A whole answered turn that names its session. */
const answerTurn = (session: string, id: string, text: string, used = 0) => [
  init(session),
  startMsg(id),
  open(text),
  done(id, text, used),
];

const pane = (p: Page) => p.getByRole("complementary", { name: "Chat" });
const turns = (p: Page) => pane(p).locator("[data-turn]");
const model = (p: Page) => pane(p).getByRole("combobox", { name: "Model" });
const pie = (p: Page) => pane(p).getByRole("button", { name: /^Context \d+%$/ });
async function say(p: Page, words: string): Promise<void> {
  await pane(p).getByRole("textbox", { name: "Message" }).fill(words);
  await pane(p).getByRole("button", { name: "Send" }).click();
}
const ended = (p: Page, n: number) => expect(turns(p).nth(n).locator('[data-role="turn-end"]')).toBeVisible();

test("21.1 model and context fill survive a restart", async ({ page: p }) => {
  const w = await project({
    roles: {
      chat: { replies: [answerTurn("sess-1", "m1", "Hello there", 50000)] },
    },
  });
  await p.goto(`${w.url}/map`);
  await model(p).selectOption({ label: "Opus" });
  await expect(model(p).locator("option:checked")).toHaveText("Opus");
  await say(p, "Remember the number seven");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("Hello there");
  await ended(p, 0);
  await expect(pie(p)).toBeVisible();
  const before = await pie(p).getAttribute("aria-label");
  expect(before).not.toBe("Context 0%");
  await pie(p).click();
  const detailBefore = await p.getByRole("dialog", { name: "Context" }).innerText();

  // The restarted agent plays its first reply for the next message.
  w.setScript({
    roles: { chat: { replies: [answerTurn("sess-1", "m2", "You asked: Remember the number seven", 50000)] } },
  });
  await w.restart();
  await p.goto(`${w.url}/map`);
  await expect(model(p).locator("option:checked")).toHaveText("Opus");
  await expect(pie(p)).toHaveAttribute("aria-label", before as string);
  await pie(p).click();
  expect(await p.getByRole("dialog", { name: "Context" }).innerText()).toBe(detailBefore);
  await say(p, "What did I ask you before?");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("You asked: Remember the number seven");
  const launches = w.launches();
  expect(launches).toHaveLength(2);
  const args = launches[1]?.args ?? [];
  expect(args[args.indexOf("--resume") + 1]).toBe("sess-1");
  expect(args[args.indexOf("--model") + 1]).toBe("claude-opus-5-5");
});

test("21.2 a dead stored session starts again and delivers the waiting message", async ({ page: p }) => {
  const w = await project({ roles: { chat: { replies: [answerTurn("sess-old", "m1", "First answer")] } } });
  await p.goto(`${w.url}/map`);
  await say(p, "Hello");
  await ended(p, 0);
  // Claude Code no longer holds sess-old.
  w.setScript({ roles: { chat: { sessions: ["other"], replies: [answerTurn("sess-new", "m2", "Fresh answer")] } } });
  await w.restart();
  await p.goto(`${w.url}/map`);
  await say(p, "Are you there?");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("Fresh answer");
  await ended(p, 0);
  await expect(pane(p).locator('[data-role="turn-end"]', { hasText: "not delivered" })).toHaveCount(0);
  await expect(turns(p)).toHaveCount(1);
  const launches = w.launches();
  expect(launches).toHaveLength(3);
  expect(launches[1]?.args).toContain("--resume");
  expect(launches[2]?.args).not.toContain("--resume");
  expect(launches[2]?.messages.length).toBe(1);
  expect(launches[2]?.messages[0]).toContain("Are you there?");
});

const ERR = ["Error: upstream failed", "  detail one", "  detail two", "  detail three", "  detail four"];
const crashing = (lines: string[]) => ({
  roles: { chat: { replies: [[{ stderr: `${lines.join("\n")}\n` }, { crash: 1 }]] } },
});

test("21.3 another crash retries once, says send again, shows the whole error", async ({ page: p }) => {
  const w = await project({ roles: { chat: { replies: [answerTurn("sess-1", "m1", "Earlier answer")] } } });
  await p.goto(`${w.url}/map`);
  await say(p, "First");
  await ended(p, 0);
  w.setScript(crashing(ERR));
  await w.restart();
  await p.goto(`${w.url}/map`);
  const before = w.launches().length;
  await say(p, "Second");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toHaveText("Your message was not delivered. Send it again.");
  expect(w.launches().length - before).toBe(2); // the start and one more
  const err = pane(p).locator('[data-role="agent-error"]');
  for (const line of ERR) await expect(err).toContainText(line.trim());
  // The agent can start again.
  w.setScript({ roles: { chat: { replies: [answerTurn("sess-1", "m3", "Back again")] } } });
  await say(p, "Second again");
  await expect(pane(p).locator(".msg.agent").last()).toHaveText("Back again");
  const last = w.launches().at(-1);
  expect(last?.args[(last?.args.indexOf("--resume") ?? -1) + 1]).toBe("sess-1");
});

test("21.4 a login problem shows at once, with no retry", async ({ page: p }) => {
  const LOGIN = ["Not logged in", "Please run claude auth login", "then try again"];
  const w = await project(crashing(LOGIN));
  await p.goto(`${w.url}/map`);
  await say(p, "Hello");
  const err = pane(p).locator('[data-role="agent-error"]');
  for (const line of LOGIN) await expect(err).toContainText(line);
  expect(w.launches()).toHaveLength(1);
  console.log("21.4 notice:", await turns(p).nth(0).locator('[data-role="turn-end"]').innerText());
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toHaveText("Your message was not delivered. Send it again.", { timeout: 3000 });
});

test("21.5 switch and clear refuse during a turn, restart quietly when idle", async ({ page: p }) => {
  const long = [init("sess-1"), startMsg("m1"), open("Working"), { pause: 2500 }, done("m1", "Long answer")];
  const w = await project({ roles: { chat: { replies: [long] } } });
  await p.goto(`${w.url}/map`);
  await model(p).selectOption({ label: "Sonnet" });
  await expect(model(p).locator("option:checked")).toHaveText("Sonnet");
  const bg = await pie(p).evaluate((e) => getComputedStyle(e).backgroundImage);
  expect(bg).toContain("rgb(14, 165, 233)");
  await say(p, "Do a long task");
  await expect(turns(p).nth(0).locator(".msg.agent")).toBeVisible();
  // while the turn runs
  const refused = await model(p)
    .selectOption({ label: "Opus" }, { timeout: 1500 })
    .then(() => false)
    .catch(() => true);
  expect(refused).toBe(true);
  await expect(model(p).locator("option:checked")).toHaveText("Sonnet");
  await ended(p, 0);
  // the literal label of the step
  const literal = await model(p)
    .selectOption({ label: "Sonnet with Opus advisor" }, { timeout: 2000 })
    .then(() => true)
    .catch(() => false);
  // the label the product offers
  await model(p).selectOption({ label: "Sonnet + Opus advisor" });
  await expect(model(p).locator("option:checked")).toHaveText("Sonnet + Opus advisor");
  await expect(pane(p).locator('[data-role="agent-error"]')).toHaveCount(0);
  await pie(p).click();
  const dialog = p.getByRole("dialog", { name: "Context" });
  await expect(dialog).toContainText(/\d+% of the context window/);
  await dialog.getByRole("button", { name: "Clear context" }).click();
  await expect(pane(p).locator('[data-role="agent-error"]')).toHaveCount(0);
  await expect(turns(p)).toHaveCount(0);
  await say(p, "Next message");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("Long answer");
  await ended(p, 0);
  await expect(pane(p).locator('[data-role="agent-error"]')).toHaveCount(0);
  expect(literal, 'the selector offers the label "Sonnet with Opus advisor"').toBe(true);
});
