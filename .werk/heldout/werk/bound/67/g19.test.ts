// 19.1-19.5: the prompt each agent starts with, and the subagent link check.
import { expect, test } from "bun:test";
import { copyFileSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { make as makeProject, type P } from "./lib.ts";
import { CHECKOUT, clone, make } from "./repo.ts";

const INSTRUCTIONS = readFileSync(join(CHECKOUT, "src", "agent", "instructions.md"), "utf8");
const FIRST_RULE_HEADING = "# werk — how to work with the decision map";

const promptOf = (args: string[]) => args[args.indexOf("--append-system-prompt") + 1] ?? "";

/** A map with a root, a build-rules card #how, and the given rule titles under it. */
function rulesMap(p: P, titles: string[]): void {
  p.card("root", { title: "Root", status: "decided", who: "me" });
  p.card("how", { title: "How it is built", parent: "root", status: "decided", who: "me" });
  titles.forEach((title, i) => p.card(`rule-${i}`, { title, parent: "how", status: "decided", who: "me" }));
}

/** The person starts a build pass on a ticket. No verb or page action for it was found; this tries `werk build`. */
async function startBuild(p: P): Promise<{ code: number; prompt: string; args: string[]; err: string }> {
  writeFileSync(join(p.dir, "ticket-01.md"), "# Ticket 1\n");
  p.script({ roles: { builder: { replies: [[{ event: { type: "result", subtype: "success" } }]] } } });
  const run = await p.w("build", "ticket-01.md");
  const launch = p.launches().find((l) => l.role === "builder");
  return { code: run.code, prompt: promptOf(launch?.args ?? []), args: launch?.args ?? [], err: run.err };
}

test("19.1 a build pass in another project starts with the instructions, subagents and rule titles", async () => {
  const p = makeProject();
  rulesMap(p, ["Money is stored in cents", "Every price has a currency", "Totals round half up"]);
  const build = await startBuild(p);
  expect(build.err).not.toContain("unknown verb");
  expect(build.code).toBe(0);
  const prompt = build.prompt;
  const at = prompt.indexOf(FIRST_RULE_HEADING);
  expect(at).toBeGreaterThan(0);
  expect(prompt).not.toContain("{{werk}}");
  expect(prompt).toContain(`${CHECKOUT}/src/cli.ts`.replace("/.werk-heldout/..", ""));
  expect(prompt).not.toMatch(/#werk-[a-z]/);
  for (const t of ["Money is stored in cents", "Every price has a currency", "Totals round half up"])
    expect(prompt.indexOf(t)).toBeGreaterThan(at);
  const agents = JSON.parse(build.args[build.args.indexOf("--agents") + 1] ?? "{}");
  expect(Object.keys(agents).sort()).toEqual(["prototyper", "test-scope"]);
});

test("19.2 a chat agent gets the instructions, but a sample agent does not", async () => {
  const p = makeProject();
  rulesMap(p, ["Money is stored in cents"]);
  p.card("open-one", { title: "An open card", parent: "root" });
  const text = (id: string, words: string) => [
    { event: { type: "stream_event", event: { type: "message_start", message: { id } } } },
    { event: { type: "assistant", message: { id, content: [{ type: "text", text: words }] } } },
  ];
  p.script({
    roles: {
      chat: { replies: [text("m1", "hello back")] },
      sample: { replies: [[{ event: { type: "result", subtype: "success" } }]] },
    },
  });
  const server = p.start([process.execPath, join(CHECKOUT, "src", "cli.ts"), "serve", "--port", "0"]);
  const reader = server.stdout.getReader();
  let out = "";
  while (!/http:\/\/\S+\/map/.test(out)) out += new TextDecoder().decode((await reader.read()).value);
  const base = (/http:\/\/\S+(?=\/map)/.exec(out) as RegExpExecArray)[0];
  const page = await (await fetch(`${base}/map`)).text();
  const token = /name="werk-token" content="([^"]+)"/.exec(page)?.[1] ?? "";
  const sent = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-werk-token": token },
    body: JSON.stringify({ text: "hello" }),
  });
  expect(sent.status).toBe(200);
  for (let i = 0; i < 200 && !p.launches().some((l) => l.role === "chat"); i++) await Bun.sleep(25);
  const chat = promptOf(p.launches().find((l) => l.role === "chat")?.args ?? []);
  expect(chat).toContain(FIRST_RULE_HEADING);
  expect(chat).toContain("Money is stored in cents");

  // The person samples options for the open card. No page action or verb for it was found; this tries `werk sample`.
  const sample = await p.w("sample", "open-one");
  expect(sample.err).not.toContain("unknown verb");
  const launch = p.launches().find((l) => l.role === "sample");
  expect(launch).toBeDefined();
  const prompt = promptOf(launch?.args ?? []);
  expect(prompt).not.toContain(FIRST_RULE_HEADING);
  expect(prompt).not.toContain("Money is stored in cents");
});

test("19.3 a project with no build rules gets no title list", async () => {
  const p = makeProject();
  rulesMap(p, []);
  const build = await startBuild(p);
  expect(build.err).not.toContain("unknown verb");
  expect(build.prompt).toContain(FIRST_RULE_HEADING);
  expect(build.prompt).not.toContain("build rules");
});

test("19.4 in werk's own checkout the instructions appear one time", async () => {
  const p = makeProject();
  rulesMap(p, ["Money is stored in cents"]);
  copyFileSync(join(CHECKOUT, "AGENTS.md"), join(p.dir, "AGENTS.md"));
  const build = await startBuild(p);
  expect(build.err).not.toContain("unknown verb");
  const prompt = build.prompt;
  // The include line names the shipped file; the prompt holds the text itself at most once.
  const count = prompt.split(FIRST_RULE_HEADING).length - 1;
  expect(count).toBe(1);
  expect(prompt.indexOf("Money is stored in cents")).toBeGreaterThan(prompt.indexOf(FIRST_RULE_HEADING));
  expect(INSTRUCTIONS).toContain(FIRST_RULE_HEADING);
});

test("19.5 the repository check catches a subagent copy that replaces its link", () => {
  const dir = clone();
  expect(make(dir, "test").code).toBe(0);
  const link = join(dir, ".claude", "agents", "test-scope.md");
  rmSync(link);
  copyFileSync(join(dir, "src", "agent", "subagents", "test-scope.md"), link);
  const broken = make(dir, "test");
  expect(broken.code).not.toBe(0);
  expect(broken.all).toContain("test-scope");
  rmSync(link);
  symlinkSync(join("..", "..", "src", "agent", "subagents", "test-scope.md"), link);
  expect(make(dir, "test").code).toBe(0);
}, 1_800_000);
