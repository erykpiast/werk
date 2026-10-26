// Held-out steps 19.1-19.4: the prompt that werk gives each agent it starts.
import { afterEach, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startServer, TOKEN_HEADER, type Server } from "../src/serve/server.ts";
import { FAKE_DIR_VAR } from "../src/test/fake-script.ts";
import { freshProject, type Project } from "../src/test/project.ts";

const CHECKOUT = join(import.meta.dir, "..");
const INSTRUCTIONS = readFileSync(join(CHECKOUT, "src/agent/instructions.md"), "utf8");
/** A line of the shipped instructions that has no placeholder in it. */
const MARK = "## Keep the map current, every turn";

let server: Server | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
  delete process.env[FAKE_DIR_VAR];
});

function seed(p: Project, events: object[]) {
  const log = join(p.dir, ".werk", "log.jsonl");
  events.forEach((payload, i) =>
    appendFileSync(log, `${JSON.stringify({ seq: i + 1, at: "t", actor: "you", ...payload })}\n`),
  );
}
const card = (id: string, title: string, parent?: string, status = "decided") => ({
  type: "node.added",
  payload: { id, kind: "card", title, status, ...(parent ? { parent } : {}) },
});

/** A map with a root, a build-rules card "how" with three decided rules, and an open card "feat". */
function rulesMap(p: Project, rules = 3) {
  const evs = [card("root", "Root"), card("how", "How this project is built", "root")];
  for (let i = 1; i <= rules; i++) evs.push(card(`rule-${i}`, `Rule number ${i} title`, "how"));
  evs.push(card("feat", "A feature", "root", "open"));
  seed(p, evs);
}

function ticket(p: Project) {
  mkdirSync(join(p.dir, "tickets"), { recursive: true });
  writeFileSync(join(p.dir, "tickets", "01-feature.md"), "# Build the feature\n\ncites: #feat\n");
}

/** Starts a build pass on a ticket, the way a person starts one from the command line. */
async function buildPass(p: Project) {
  return p.werk(["build", "tickets/01-feature.md"]);
}

const promptOf = (args: string[]) => args[args.indexOf("--append-system-prompt") + 1] ?? "";

test("19.1 a build pass in another project starts with the werk text, its subagents and the rule titles", async () => {
  const p = freshProject();
  rulesMap(p);
  ticket(p);
  p.script({ roles: { builder: { replies: [[]] } } });
  const run = await buildPass(p);
  expect(run.code).toBe(0);
  const builds = p.launches().filter((l) => l.role === "builder");
  expect(builds.length).toBeGreaterThan(0);
  const args = builds[0]?.args ?? [];
  const prompt = promptOf(args);
  expect(prompt).toContain(MARK);
  expect(prompt.indexOf(MARK)).toBeGreaterThan(0);
  expect(prompt).toContain(join(CHECKOUT, "src", "cli.ts"));
  expect(prompt).not.toContain("{{werk}}");
  expect(prompt).not.toMatch(/#werk-/);
  for (let i = 1; i <= 3; i++) expect(prompt.indexOf(`Rule number ${i} title`)).toBeGreaterThan(prompt.indexOf(MARK));
  const agents = JSON.parse(args[args.indexOf("--agents") + 1] ?? "{}");
  expect(Object.keys(agents).sort()).toEqual(["prototyper", "test-scope"]);
  for (const a of Object.values(agents) as { prompt: string }[]) expect(a.prompt).toContain(CHECKOUT);
});

test("19.2 a chat agent gets the instructions, but a sample agent does not", async () => {
  const p = freshProject();
  rulesMap(p);
  process.env[FAKE_DIR_VAR] = p.env[FAKE_DIR_VAR];
  const reply = { event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "Hello." }] } } };
  p.script({ roles: { chat: { replies: [[reply]] }, sample: { replies: [[reply]] } } });
  const log = join(p.dir, ".werk", "log.jsonl");
  server = await startServer(log, 0);
  const page = await (await fetch(`http://localhost:${server.port}/map/root`)).text();
  const token = /<meta name="werk-token" content="([^"]+)">/.exec(page)?.[1] ?? "";
  const sent = await fetch(`http://localhost:${server.port}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", [TOKEN_HEADER]: token },
    body: JSON.stringify({ text: "hi" }),
  });
  expect(sent.status).toBe(200);
  // The agent answers: its launch is recorded.
  const deadline = Date.now() + 10000;
  while (!p.launches().some((l) => l.role === "chat") && Date.now() < deadline) await Bun.sleep(50);
  const chatPrompt = promptOf(p.launches().find((l) => l.role === "chat")?.args ?? []);
  expect(chatPrompt).toContain(MARK);
  expect(chatPrompt).toContain("Rule number 1 title");
  // The person samples options for the open card "feat".
  const sample = await p.werk(["sample", "feat"]);
  expect(sample.code).toBe(0);
  const samples = p.launches().filter((l) => l.role === "sample");
  expect(samples.length).toBeGreaterThan(0);
  const samplePrompt = promptOf(samples[0]?.args ?? []);
  expect(samplePrompt).not.toContain(MARK);
  expect(samplePrompt).not.toContain("Rule number 1 title");
});

test("19.3 a project with no build rules gets no title list", async () => {
  const p = freshProject();
  rulesMap(p, 0);
  ticket(p);
  p.script({ roles: { builder: { replies: [[]] } } });
  const run = await buildPass(p);
  expect(run.code).toBe(0);
  const prompt = promptOf(p.launches().find((l) => l.role === "builder")?.args ?? []);
  expect(prompt).toContain(MARK);
  expect(prompt).not.toContain("build rules");
});

test("19.4 in werk's own checkout the instructions appear one time", async () => {
  const p = freshProject();
  rulesMap(p);
  ticket(p);
  writeFileSync(join(p.dir, "AGENTS.md"), readFileSync(join(CHECKOUT, "AGENTS.md"), "utf8"));
  mkdirSync(join(p.dir, "src", "agent"), { recursive: true });
  writeFileSync(join(p.dir, "src", "agent", "instructions.md"), INSTRUCTIONS);
  p.script({ roles: { builder: { replies: [[]] } } });
  const run = await buildPass(p);
  expect(run.code).toBe(0);
  const prompt = promptOf(p.launches().find((l) => l.role === "builder")?.args ?? []);
  expect(prompt.split(MARK).length - 1).toBe(1);
  expect(prompt.indexOf("Rule number 1 title")).toBeGreaterThan(prompt.indexOf(MARK));
});
