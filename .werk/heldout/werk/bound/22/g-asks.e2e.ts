// Held-out: ask bar steps 22.1-22.5 (22.2 restart part runs on the harness server).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test as pwTest } from "@playwright/test";
import { test as hTest } from "../e2e/harness.ts";
import { project, stop } from "../e2e/project.ts";
import { SCRIPT_FILE } from "../src/test/fake-script.ts";
import { askLog, box, launches, more, open, pane, reply, say, start, turns } from "./g-util.ts";

pwTest.afterEach(stop);

const fakeOf = (dir: string) => join(dir, "..", "fake");
const answersOf = (dir: string) => launches(fakeOf(dir)).flatMap((l) => l.answers);

pwTest("22.1 Allow once lets a blocked tool call finish its turn", async ({ page: p }) => {
  const input = { command: "curl -s https://example.com" };
  const w = await project({
    roles: {
      chat: {
        replies: [
          [
            { ask: { id: "r1", tool: "Bash", input, reason: "no rule matches curl" } },
            { pause: 1500 },
            ...reply("m1", "Fetched the page."),
          ],
        ],
      },
    },
  });
  await p.goto(`${w.url}/map`);
  await say(p, "Fetch the page");
  const ask = pane(p).getByRole("region", { name: "Bash wants to run" });
  await expect(ask).toContainText("Bash");
  await expect(ask.locator("pre code")).toContainText('"command": "curl -s https://example.com"');
  await expect(ask.locator("[data-role=ask-reason]")).toContainText("no rule matches curl");
  await expect(ask.getByRole("button")).toHaveText(["Allow once", "Deny"]);
  await ask.getByRole("button", { name: "Allow once" }).click();
  // every button disabled (or the bar already gone after the answer)
  const states = await ask
    .getByRole("button")
    .evaluateAll((els) => els.map((e) => (e as HTMLButtonElement).disabled))
    .catch(() => [] as boolean[]);
  expect(states.every((d) => d)).toBe(true);
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("Fetched the page.");
  expect(answersOf(w.dir)).toEqual([{ behavior: "allow", updatedInput: input }]);
  const log = askLog(w.dir);
  expect(log).toHaveLength(1);
  expect(log[0]).toMatchObject({ tool: "Bash", input, reason: "no rule matches curl", decision: "allow" });
});

hTest("22.2 Always allow applies its rule now and after a restart", async ({ page: p, harness }) => {
  const fake = mkdtempSync(join(tmpdir(), "werk-ho-fake-"));
  const rule = { type: "addRules", rules: [{ toolName: "Bash", ruleContent: "mkdir:*" }], behavior: "allow" };
  const input = { command: "mkdir -p build" };
  const call = (id: string) => ({
    event: { type: "assistant", message: { id: `m-${id}`, content: [{ type: "tool_use", id, name: "Bash", input }] } },
  });
  const result = (id: string) => ({
    event: {
      type: "user",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "" }] },
    },
  });
  writeFileSync(
    join(fake, SCRIPT_FILE),
    JSON.stringify({
      roles: {
        chat: {
          replies: [
            [{ ask: { id: "r1", tool: "Bash", input, suggestions: [rule] } }, ...reply("m1", "made it")],
            [call("t2"), result("t2"), ...reply("m2", "made it again")],
          ],
        },
      },
    }),
  );
  try {
    const w = await harness.start({ env: { ...process.env, FAKE_AGENT_DIR: fake } });
    await p.goto(`${w.url}/map`);
    await say(p, "Make the folder");
    const ask = pane(p).getByRole("region", { name: "Bash wants to run" });
    await expect(ask.getByRole("button", { name: "Always allow Bash(mkdir:*)" })).toBeVisible();
    await ask.getByRole("button", { name: "Always allow Bash(mkdir:*)" }).click();
    await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
    expect(askLog(w.dir)).toMatchObject([{ decision: "always", widened: ["Bash(mkdir:*)"] }]);
    // The running agent got the rule back, so the same call in the same conversation needs no ask.
    expect(launches(fake)[0]?.answers).toEqual([
      { behavior: "allow", updatedInput: input, updatedPermissions: [rule] },
    ]);
    await say(p, "Again");
    await expect(turns(p).nth(1).locator(".msg.agent")).toHaveText("made it again");
    await expect(pane(p).getByRole("region", { name: "Asks" })).toHaveCount(0);
    // After a restart Claude Code resolves the call from its allow flags, so the fake makes the call with no ask.
    writeFileSync(
      join(fake, SCRIPT_FILE),
      JSON.stringify({ roles: { chat: { replies: [[call("t3"), result("t3"), ...reply("m3", "made it after restart")]] } } }),
    );
    // restart werk
    await w.restart();
    await p.goto(`${w.url}/map`);
    await say(p, "Make it after the restart");
    await expect(turns(p).last().locator('[data-role="turn-end"]')).toBeVisible();
    await expect(pane(p).getByRole("region", { name: "Asks" })).toHaveCount(0);
    const after = launches(fake).at(-1);
    expect(launches(fake).length).toBe(2);
    const at = after?.args.indexOf("--allowedTools") ?? -1;
    expect(at).toBeGreaterThanOrEqual(0);
    expect(after?.args[at + 1]).toBe("Bash(mkdir:*)");
  } finally {
    rmSync(fake, { recursive: true, force: true });
  }
});

pwTest("22.3 keyboard answers and a second click send only one answer", async ({ page: p }) => {
  const w = await project({
    roles: {
      chat: {
        replies: [
          [
            { ask: { id: "r1", tool: "Bash", input: { command: "rm -rf dist" } } },
            { pause: 3000 },
            { ask: { id: "r2", tool: "Bash", input: { command: "ls" } } },
          ],
          reply("m2", "Got your draft."),
        ],
      },
    },
  });
  await p.goto(`${w.url}/map`);
  await say(p, "Clean up");
  const ask1 = pane(p).locator('[data-ask="r1"]');
  await expect(ask1).toBeVisible();
  await box(p).fill("my draft message");
  await box(p).press("Escape");
  await expect.poll(() => answersOf(w.dir).length).toBe(1);
  expect(answersOf(w.dir)[0]).toMatchObject({ behavior: "deny" });
  await expect(turns(p)).toHaveCount(1);
  await expect(box(p)).toHaveValue("my draft message");
  // click Allow once on the same bar after the answer
  const allow1 = ask1.getByRole("button", { name: "Allow once" });
  if ((await allow1.count()) > 0) await allow1.click({ force: true, timeout: 2000 }).catch(() => undefined);
  await p.waitForTimeout(500);
  expect(
    answersOf(w.dir).filter(
      (a) => JSON.stringify(a).includes("rm -rf") || (a as { behavior: string }).behavior === "deny",
    ),
  ).toHaveLength(1);
  const r1 = askLog(w.dir).filter((e) => JSON.stringify(e.input).includes("rm -rf"));
  expect(r1).toHaveLength(1);
  expect(r1[0]?.decision).toBe("deny");
  // a new ask bar: Cmd+Enter allows
  const ask2 = pane(p).locator('[data-ask="r2"]');
  await expect(ask2).toBeVisible();
  await box(p).press("Meta+Enter");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  expect(answersOf(w.dir)[1]).toMatchObject({ behavior: "allow" });
  await expect(box(p)).toHaveValue("my draft message");
  await expect(turns(p)).toHaveCount(1);
  // the refusal reached the agent
  expect(answersOf(w.dir)[0]).toMatchObject({ message: "The person denied this tool call." });
  await box(p).press("Enter");
  await expect(turns(p)).toHaveCount(2);
  await expect(turns(p).nth(1).locator(".msg.user")).toHaveText("my draft message");
  await expect(turns(p).nth(1).locator(".msg.agent")).toHaveText("Got your draft.");
});

pwTest("22.4 the user answers an agent's question with the form", async ({ page: p, browser }) => {
  const input = {
    questions: [
      {
        question: "Which store?",
        header: "Store",
        options: [
          { label: "Postgres", description: "One server for every reader" },
          { label: "SQLite", description: "One file beside the map" },
        ],
        multiSelect: false,
      },
    ],
  };
  const w = await project({
    roles: {
      chat: {
        replies: [
          [
            {
              event: {
                type: "assistant",
                message: { id: "mq", content: [{ type: "tool_use", id: "tool-q1", name: "AskUserQuestion", input }] },
              },
            },
            { ask: { id: "q1", tool: "AskUserQuestion", input } },
            { pause: 8000 },
            {
              event: {
                type: "user",
                message: {
                  role: "user",
                  content: [
                    {
                      type: "tool_result",
                      tool_use_id: "tool-q1",
                      is_error: true,
                      content: 'For "Which store?": SQLite',
                    },
                  ],
                },
              },
            },
            start("m2"),
            open("SQLite it is."),
            { event: { type: "assistant", message: { id: "m2", content: [{ type: "text", text: "SQLite it is." }] } } },
          ],
        ],
      },
    },
  });
  await p.goto(`${w.url}/map`);
  await say(p, "Ask me");
  const form = pane(p).getByRole("form", { name: "The agent asks" });
  await expect(form).toContainText("Which store?");
  await expect(form).toContainText("A. Postgres");
  await expect(form).toContainText("B. SQLite");
  await expect(form).toContainText("One server for every reader");
  await expect(form).toContainText("One file beside the map");
  await expect(form.getByRole("textbox", { name: "Other answer to: Which store?" })).toBeVisible();
  await expect(form.getByRole("button", { name: "Submit answer" })).toBeVisible();
  await expect(form.getByRole("button", { name: "Decline" })).toBeVisible();
  // Raw JSON may sit in the DOM inside a closed disclosure; it must not be visible.
  const visibleJson = await pane(p).evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let found = false;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const parent = n.parentElement;
      if (!n.textContent?.includes('"questions"') || parent === null) continue;
      if (parent.checkVisibility()) found = true;
    }
    return found;
  });
  expect(visibleJson).toBe(false);
  await form.getByRole("radio", { name: /SQLite/ }).check();
  // another tab on the same conversation causes a re-render: it adds a note, the map changes
  const other = await browser.newPage();
  await other.goto(`${w.url}/map`);
  await other.getByRole("textbox", { name: "Note" }).fill("a note from the other tab");
  await other.getByRole("form", { name: "Add a note" }).getByRole("button").click();
  await expect(p.getByText("a note from the other tab")).toBeVisible();
  await expect(form.getByRole("radio", { name: /SQLite/ })).toBeChecked();
  await form.getByRole("button", { name: "Submit answer" }).click();
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible({ timeout: 15000 });
  expect(answersOf(w.dir)).toEqual([{ behavior: "deny", message: 'For "Which store?": SQLite' }]);
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("SQLite it is.");
  await expect(turns(p).nth(0).locator('[data-role="tool-output"][data-error="true"]')).toHaveCount(0);
  expect(askLog(w.dir)).toMatchObject([{ tool: "AskUserQuestion", decision: "answer" }]);
  await other.close();
});

pwTest("22.5 the user declines an agent's question", async ({ page: p }) => {
  const input = {
    questions: [
      {
        question: "Which store?",
        header: "",
        options: [
          { label: "A", description: "" },
          { label: "B", description: "" },
        ],
        multiSelect: false,
      },
    ],
  };
  const w = await project({
    roles: {
      chat: {
        replies: [
          [{ ask: { id: "q1", tool: "AskUserQuestion", input } }, { pause: 1500 }, ...reply("m1", "Fine, no answer.")],
        ],
      },
    },
  });
  await p.goto(`${w.url}/map`);
  await say(p, "Ask me");
  const form = pane(p).getByRole("form", { name: "The agent asks" });
  await expect(form).toBeVisible();
  await form.getByRole("button", { name: "Decline" }).click();
  const states = await form
    .getByRole("button")
    .evaluateAll((els) => els.map((e) => (e as HTMLButtonElement).disabled))
    .catch(() => [] as boolean[]);
  expect(states.every((d) => d)).toBe(true);
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  expect(answersOf(w.dir)).toEqual([{ behavior: "deny", message: "The person declined to answer." }]);
  expect(askLog(w.dir)).toMatchObject([{ tool: "AskUserQuestion", decision: "deny" }]);
});

// keep the unused helper imports referenced
void more;
void readFileSync;
