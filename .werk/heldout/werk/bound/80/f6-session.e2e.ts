import { expect, type Page, test } from "@playwright/test";
import { boot, done, init, pane, reply, say, start, open, stopAll, turns } from "./f6-lib.ts";

test.afterEach(stopAll);

const usageReply = (id: string, text: string, session: string, tokens: number) => [
  init(session),
  start(id),
  open(text),
  done(id, text, { input_tokens: tokens, output_tokens: 0 }),
];
const model = (p: Page) => pane(p).getByRole("combobox", { name: "Model" });
const pie = (p: Page) => pane(p).getByRole("button", { name: /^Context \d+%$/ });
const launchArgs = (b: Awaited<ReturnType<typeof boot>>) =>
  b.launches().flatMap((e) => (e.kind === "launch" ? [e.args] : []));

test("21.1 model and fill survive a restart, session continues", async ({ page: p }) => {
  const b = await boot({ roles: { chat: { replies: [usageReply("m1", "Noted.", "sess-1", 50000)], sessions: ["sess-1"] } } });
  await p.goto(`${b.url}/map`);
  await model(p).selectOption({ label: "Opus" });
  await expect(model(p)).toHaveValue(/opus/);
  await say(p, "Remember the number seven");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  await expect(pie(p)).toHaveAttribute("aria-label", "Context 25%");
  await b.restart();
  b.setScript({ roles: { chat: { replies: [reply("m2", "You asked me to remember the number seven.")], sessions: ["sess-1"] } } });
  await p.goto(`${b.url}/map`);
  await expect(model(p).locator("option:checked")).toHaveText("Opus");
  await expect(pie(p)).toHaveAttribute("aria-label", "Context 25%");
  await say(p, "What did I ask you before?");
  await expect(turns(p).last().locator(".msg.agent")).toHaveText("You asked me to remember the number seven.");
  const args = launchArgs(b);
  const last = args[args.length - 1] ?? [];
  expect(last).toContain("--resume");
  expect(last[last.indexOf("--resume") + 1]).toBe("sess-1");
  expect(last[last.indexOf("--model") + 1]).toBe("claude-opus-5-5");
});

test("21.2 a dead stored session starts again and delivers", async ({ page: p }) => {
  const b = await boot({ roles: { chat: { replies: [usageReply("m1", "First.", "sess-1", 1000)] } } });
  await p.goto(`${b.url}/map`);
  await say(p, "First message");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  await b.restart();
  b.setScript({ roles: { chat: { replies: [usageReply("m2", "Fresh answer.", "sess-2", 1000)], sessions: ["sess-other"] } } });
  await p.goto(`${b.url}/map`);
  await say(p, "Second message");
  await expect(turns(p).last().locator(".msg.agent")).toHaveText("Fresh answer.");
  await expect(pane(p)).not.toContainText("Your message was not delivered");
  const args = launchArgs(b);
  expect(args.length).toBe(3);
  expect(args[1]).toContain("--resume");
  expect(args[2]).not.toContain("--resume");
  const heard = b.launches().flatMap((e) => (e.kind === "message" ? [JSON.stringify(e.message)] : []));
  expect(heard[heard.length - 1]).toContain("Second message");
});

const ERR = "fatal: runner exploded\n  at step one\n  at step two\n  at step three";

test("21.3 another crash retries once, asks to send again, shows the whole error", async ({ page: p }) => {
  const b = await boot({ roles: { chat: { replies: [usageReply("m1", "First.", "sess-1", 1000)] } } });
  await p.goto(`${b.url}/map`);
  await say(p, "First message");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  await b.restart();
  b.setScript({ roles: { chat: { replies: [[{ stderr: `${ERR}\n` }, { crash: 1 }]] } } });
  await p.goto(`${b.url}/map`);
  const before = launchArgs(b).length;
  await say(p, "Second message");
  await expect(pane(p)).toContainText("Your message was not delivered. Send it again.");
  const err = pane(p).locator('[data-role="agent-error"]');
  for (const l of ERR.split("\n")) await expect(err).toContainText(l.trim());
  expect(launchArgs(b).length - before).toBe(2);
  b.setScript({ roles: { chat: { replies: [reply("m3", "Back again.")], sessions: ["sess-1"] } } });
  await say(p, "Third message");
  await expect(turns(p).last().locator(".msg.agent")).toHaveText("Back again.");
  const args = launchArgs(b);
  const last = args[args.length - 1] ?? [];
  expect(last[last.indexOf("--resume") + 1]).toBe("sess-1");
});

test("21.4 a login problem shows at once with no retry", async ({ page: p }) => {
  const LOGIN = "Not logged in\nPlease run claude auth login\nthen try again";
  const b = await boot({ roles: { chat: { replies: [[{ stderr: `${LOGIN}\n` }, { crash: 1 }]] } } });
  await p.goto(`${b.url}/map`);
  await say(p, "Hello");
  const err = pane(p).locator('[data-role="agent-error"]');
  await expect(err).toBeVisible();
  for (const l of LOGIN.split("\n")) await expect(err).toContainText(l);
  expect(launchArgs(b).length).toBe(1);
  await expect(pane(p)).toContainText("Your message was not delivered. Send it again.");
});

test("21.5 label named by the step: Sonnet with Opus advisor", async ({ page: p }) => {
  const b = await boot({ roles: { chat: { replies: [[...reply("m1", "ok"), { pause: 2500 }], reply("m2", "later")] } } });
  await p.goto(`${b.url}/map`);
  await model(p).selectOption({ label: "Sonnet" });
  await expect(model(p).locator("option:checked")).toHaveText("Sonnet");
  const color = await pie(p).evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(color).toContain("rgb(14, 165, 233)");
  await say(p, "A long turn");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("ok");
  await expect(model(p)).toBeDisabled();
  const status = await p.evaluate(async () => {
    const token = document.querySelector('meta[name="werk-token"]')?.getAttribute("content") ?? "";
    const r = await fetch("/api/model", {
      method: "POST",
      headers: { "content-type": "application/json", "x-werk-token": token },
      body: JSON.stringify({ model: "claude-opus-5-5", advisor: null }),
    });
    return r.status;
  });
  expect(status).toBe(409);
  await expect(model(p).locator("option:checked")).toHaveText("Sonnet");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  // the step's label
  await model(p).selectOption({ label: "Sonnet with Opus advisor" }, { timeout: 3000 });
});

test("21.5b the rest of 21.5 with the product's own label", async ({ page: p }) => {
  const b = await boot({ roles: { chat: { replies: [reply("m1", "ok")] } } });
  await p.goto(`${b.url}/map`);
  await say(p, "A turn");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  await model(p).selectOption({ label: "Sonnet + Opus advisor" });
  await expect(model(p).locator("option:checked")).toHaveText("Sonnet + Opus advisor");
  await expect(pane(p).getByRole("alert")).toHaveCount(0);
  await pie(p).click();
  const pop = pane(p).getByRole("dialog", { name: "Context" });
  await expect(pop).toContainText(/\d+% of the context window/);
  b.setScript({ roles: { chat: { replies: [reply("m2", "after clear")] } } });
  await pop.getByRole("button", { name: "Clear context" }).click();
  await expect(pane(p).getByRole("alert")).toHaveCount(0);
  await expect(pane(p).locator('[data-role="agent-error"]')).toHaveCount(0);
  await say(p, "Next message");
  await expect(turns(p).last().locator(".msg.agent")).toHaveText("after clear");
});
