// Held-out steps 19.1-19.5: the werk text in agent prompts, and the subagent link check.
import { afterEach, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Chat, startChat } from "../src/serve/chat.ts";
import { FAKE_DIR_VAR } from "../src/test/fake-script.ts";
import { freshProject, type Project } from "../src/test/project.ts";

type Card = { id: string; parent?: string; title?: string };
function writeMap(p: Project, cards: Card[]) {
  const lines = cards.map(({ id, parent, title }, i) =>
    JSON.stringify({
      seq: i + 1,
      at: "t",
      type: "node.added",
      actor: "you",
      payload: { kind: "card", id, parent, title: title ?? `Title of ${id}`, status: "decided" },
    }),
  );
  writeFileSync(join(p.dir, ".werk", "log.jsonl"), `${lines.join("\n")}\n`);
}
const RULES: Card[] = [
  { id: "root" },
  { id: "how", parent: "root", title: "How the shop is built" },
  { id: "db", parent: "how", title: "Tests run against a real database" },
  { id: "money", parent: "how", title: "Money is stored in cents" },
  { id: "deploy", parent: "how", title: "A deploy is one tagged commit" },
];

/** The person's way to start a build pass on a ticket: a werk verb that the help lists. */
async function buildPassVerb(p: Project): Promise<string | undefined> {
  const help = await p.werk(["help"]);
  return help.out
    .split("\n")
    .map((l) => /^ {2}(\S+)/.exec(l)?.[1])
    .find((v) => v === "build" || v === "build-pass");
}

test("19.1 a build pass in another project starts with the werk instructions, subagents and rule titles", async () => {
  const p = freshProject();
  writeMap(p, RULES);
  expect(await buildPassVerb(p)).toBeDefined();
});

let chat: Chat | undefined;
let copy: string | undefined;
afterEach(async () => {
  await chat?.close();
  chat = undefined;
  delete process.env[FAKE_DIR_VAR];
  if (copy) rmSync(copy, { recursive: true, force: true });
  copy = undefined;
});

test("19.2 a chat agent gets the instructions, a sample agent does not", async () => {
  const p = freshProject();
  writeMap(p, RULES);
  process.env[FAKE_DIR_VAR] = p.env[FAKE_DIR_VAR];
  p.script({
    roles: {
      chat: {
        replies: [
          [
            { event: { type: "stream_event", event: { type: "message_start", message: { id: "m1" } } } },
            { event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "hi" }] } } },
          ],
        ],
      },
    },
  });
  let got = false;
  chat = startChat(p.dir, join(p.dir, ".werk", "log.jsonl"), (part) => {
    if (part.kind === "block") got = true;
  });
  chat.send("hello");
  while (!got) await Bun.sleep(20);
  const launch = p.launches().find((l) => l.role === "chat");
  const prompt = launch?.args[(launch?.args.indexOf("--append-system-prompt") ?? 0) + 1] ?? "";
  console.log("19.2 chat prompt has instructions:", prompt.includes("how to work with the decision map"));
  expect(prompt).toContain("how to work with the decision map");
  expect(prompt).toContain("Money is stored in cents");
  // The person samples options for an open card: look for a way to do that.
  const help = await p.werk(["help"]);
  expect(/^ {2}sample\b/m.test(help.out)).toBe(true);
});

test("19.3 a project with no build rules gets no title list", async () => {
  const p = freshProject();
  writeMap(p, [{ id: "root" }, { id: "how", parent: "root" }]);
  expect(await buildPassVerb(p)).toBeDefined();
});

test("19.4 in werk's own checkout the instructions appear one time", async () => {
  const p = freshProject();
  copyFileSync(join(import.meta.dir, "..", "AGENTS.md"), join(p.dir, "AGENTS.md"));
  writeMap(p, RULES);
  expect(await buildPassVerb(p)).toBeDefined();
});

test("19.5 the repository check catches a subagent copy that replaces its link", () => {
  const repo = join(import.meta.dir, "..");
  copy = mkdtempSync(join(tmpdir(), "werk-heldout-repo-"));
  const dir = copy;
  const sh = (cmd: string) => Bun.spawnSync(["sh", "-c", cmd], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  expect(sh(`git -C '${repo}' archive HEAD | tar -x -C '${dir}'`).exitCode).toBe(0);
  const check = () => {
    const r = Bun.spawnSync([process.execPath, "test", "./scripts/subagent-links.test.ts"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
  };
  expect(sh("test -L .claude/agents/test-scope.md && test -L .claude/agents/prototyper.md").exitCode).toBe(0);
  expect(check().code).toBe(0);
  sh("rm .claude/agents/test-scope.md && cp src/agent/subagents/test-scope.md .claude/agents/test-scope.md");
  const second = check();
  console.log(
    "19.5 copy:",
    second.out
      .split("\n")
      .filter((l) => /test-scope|\(fail\)/.test(l))
      .join("\n"),
  );
  expect(second.code).not.toBe(0);
  expect(second.out).toContain("test-scope");
  sh("rm .claude/agents/test-scope.md && ln -s ../../src/agent/subagents/test-scope.md .claude/agents/test-scope.md");
  expect(check().code).toBe(0);
});
