import { expect, test } from "@playwright/test";
import { cleanup, done, init, msgStart, open, pane, reply, say, start, turns } from "./g-lib.ts";

test.afterEach(cleanup);

const usage = (n: number) => ({ input_tokens: n, output_tokens: 0 });
const chat = (...replies: unknown[]) => ({ roles: { chat: { replies } } });

test("21.1 model and context fill survive a restart; same session resumes", async ({ page: p }) => {
  const w = await start(chat([init("sess-1"), ...reply("m1", "Answer one", usage(50000))]));
  await p.goto(`${w.url}/map`);
  const select = pane(p).getByLabel("Model");
  await select.selectOption({ label: "Opus" });
  await expect(select.locator("option:checked")).toHaveText("Opus");
  await say(p, "Question about X");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  const pie = pane(p).getByRole("button", { name: /^Context \d+%$/ });
  const before = await pie.getAttribute("aria-label");
  expect(before).not.toBe("Context 0%");
  w.setScript(chat(reply("m2", "You asked about X")));
  await w.restart();
  await p.goto(`${w.url}/map`);
  await expect(pane(p).getByLabel("Model").locator("option:checked")).toHaveText("Opus");
  await expect(pane(p).getByRole("button", { name: /^Context \d+%$/ })).toHaveAttribute("aria-label", before as string);
  await say(p, "What did I ask you before?");
  await expect(turns(p).last().locator(".msg.agent")).toHaveText("You asked about X");
  const ls = w.launches();
  expect(ls).toHaveLength(2);
  expect(ls[1]?.args[ls[1].args.indexOf("--resume") + 1]).toBe("sess-1");
  expect(ls[1]?.args[ls[1].args.indexOf("--model") + 1]).toContain("opus");
});

test("21.2 dead stored session starts again and the message is delivered", async ({ page: p }) => {
  const w = await start(chat([init("sess-1"), ...reply("m1", "Answer one")]));
  await p.goto(`${w.url}/map`);
  await say(p, "First");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  // the stored session no longer exists in Claude Code
  w.setScript({ roles: { chat: { sessions: ["other"], replies: [[init("sess-2"), ...reply("m3", "New session answer")]] } } });
  await w.restart();
  await p.goto(`${w.url}/map`);
  await say(p, "Second");
  await expect(turns(p).last().locator(".msg.agent")).toHaveText("New session answer");
  await expect(pane(p)).not.toContainText("Your message was not delivered");
  const ls = w.launches();
  expect(ls).toHaveLength(3);
  expect(ls[1]?.args).toContain("--resume");
  expect(ls[2]?.args).not.toContain("--resume");
  expect(ls[2]?.messages.at(-1)).toContain("Second");
});

test("21.3 other crash retries once, says not delivered, shows the whole error; later send resumes the session", async ({ page: p }) => {
  const crash = [{ stderr: "boom line 1\nboom line 2\nboom line 3\nboom line 4\nboom line 5\nboom line 6\nboom line 7\nboom line 8\n" }, { crash: 1 }];
  const w = await start(chat([init("sess-1"), ...reply("m1", "Answer one")]));
  await p.goto(`${w.url}/map`);
  await say(p, "First");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  w.setScript(chat(crash));
  await w.restart();
  await p.goto(`${w.url}/map`);
  await say(p, "Second");
  await expect(pane(p)).toContainText("Your message was not delivered. Send it again.");
  const err = pane(p).locator('[data-role="agent-error"]');
  await expect(err).toContainText("boom line 1");
  await expect(err).toContainText("boom line 8");
  expect(w.launches()).toHaveLength(3);
  w.setScript(chat(reply("m4", "Back again")));
  await say(p, "Third");
  await expect(turns(p).last().locator(".msg.agent")).toHaveText("Back again");
  const ls = w.launches();
  expect(ls).toHaveLength(4);
  expect(ls[3]?.args[ls[3].args.indexOf("--resume") + 1]).toBe("sess-1");
});

test("21.4 login error shows at once with no retry", async ({ page: p }) => {
  const crash = [{ stderr: "Error: Not logged in\nRun claude auth login to sign in\nthird line\n" }, { crash: 1 }];
  const w = await start(chat(crash));
  await p.goto(`${w.url}/map`);
  await say(p, "Hello");
  const err = pane(p).locator('[data-role="agent-error"]');
  await expect(err).toContainText("Not logged in");
  await expect(err).toContainText("Run claude auth login to sign in");
  await expect(err).toContainText("third line");
  await p.waitForTimeout(1500);
  expect(w.launches()).toHaveLength(1);
  await expect(pane(p)).toContainText("Your message was not delivered. Send it again.", { timeout: 2000 });
});

test("21.5 switch and clear refuse during a turn and restart quietly when idle", async ({ page: p }) => {
  const w = await start(chat([init("s1"), msgStart("m1"), open("working"), { pause: 3000 }, done("m1", "working", usage(1000))]));
  await p.goto(`${w.url}/map`);
  const select = pane(p).getByLabel("Model");
  await select.selectOption({ label: "Sonnet" });
  await expect(select.locator("option:checked")).toHaveText("Sonnet");
  const pie = pane(p).getByRole("button", { name: /^Context/ });
  const bg = await pie.evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(bg).toContain("rgb(14, 165, 233)");
  await say(p, "long turn");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("working");
  await expect(select).toBeDisabled();
  await expect(select.locator("option:checked")).toHaveText("Sonnet");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible({ timeout: 10000 });
  await select.selectOption({ label: "Sonnet with Opus advisor" }, { timeout: 3000 });
  await expect(select.locator("option:checked")).toHaveText("Sonnet with Opus advisor");
  await expect(pane(p).locator('[data-role="agent-error"]')).toHaveCount(0);
  w.setScript(chat(reply("m2", "after clear")));
  await pie.click();
  const dlg = pane(p).getByRole("dialog", { name: "Context" });
  await expect(dlg).toContainText(/\d+% of the context window/);
  await dlg.getByRole("button", { name: "Clear context" }).click();
  await expect(pane(p).locator('[data-role="agent-error"]')).toHaveCount(0);
  await say(p, "next");
  await expect(turns(p).last().locator(".msg.agent")).toHaveText("after clear");
});

// Diagnostic for 21.5: the same flow with the advisor choice picked by its label in the product.
test("21.5b same flow with the product's own label for the advisor choice", async ({ page: p }) => {
  const w = await start(chat([init("s1"), ...reply("m1", "ok", usage(1000))]));
  await p.goto(`${w.url}/map`);
  const select = pane(p).getByLabel("Model");
  await select.selectOption({ label: "Sonnet + Opus advisor" });
  await expect(select.locator("option:checked")).toHaveText("Sonnet + Opus advisor");
  w.setScript(chat(reply("m2", "after clear")));
  await pane(p).getByRole("button", { name: /^Context/ }).click();
  await pane(p).getByRole("button", { name: "Clear context" }).click();
  await say(p, "next");
  await expect(turns(p).last().locator(".msg.agent")).toHaveText("after clear");
  await expect(pane(p).locator('[data-role="agent-error"]')).toHaveCount(0);
});
