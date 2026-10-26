// Steps 19.1-19.4: the prompt an agent starts with. Each step has a "user path" test (can a person
// start a build pass or a sample through a verb or a server route?) and a "library" test of
// projectAgentArgs, which a launcher would call.
import { afterEach, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { currentWerk, projectAgentArgs } from "../src/agent/launch.ts";
import { fillWerk, INSTRUCTIONS } from "../src/agent/prompt.ts";
import { type Server, startServer, TOKEN_HEADER } from "../src/serve/server.ts";
import { FAKE_DIR_VAR } from "../src/test/fake-script.ts";
import { freshProject, type Project } from "../src/test/project.ts";

const CHECKOUT = join(import.meta.dir, "..");
const BASE = "You are the build agent. Build the ticket below.";
const RULES_HEADING = "## This project's build rules";
const INSTR_HEAD = "# werk — how to work with the decision map";

let server: Server | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
  delete process.env[FAKE_DIR_VAR];
});

type Card = { id: string; parent?: string; title?: string };
function writeMap(project: Project, cards: Card[]): void {
  const lines = cards.map(({ id, parent, title }, i) =>
    JSON.stringify({
      seq: i + 1,
      at: "t",
      type: "node.added",
      actor: "you",
      payload: { kind: "card", id, parent, title: title ?? `Title of ${id}`, status: "decided" },
    }),
  );
  writeFileSync(join(project.dir, ".werk", "log.jsonl"), `${lines.join("\n")}\n`);
}
const THREE: Card[] = [
  { id: "root", title: "Root" },
  { id: "how", parent: "root", title: "How the shop is built" },
  { id: "db", parent: "how", title: "Tests run against a real database" },
  { id: "money", parent: "how", title: "Money is stored in cents" },
  { id: "deploy", parent: "how", title: "A deploy is one tagged commit" },
];
const promptOf = (args: string[]) => args[args.indexOf("--append-system-prompt") + 1] as string;

/** Every way a person can start a build pass or a sample: verbs in help, routes in the server, words in the client. */
async function userPaths(project: Project): Promise<string[]> {
  const help = await project.werk(["help"]);
  const verbs = [...help.out.matchAll(/^ {2}([a-z][\w-]*)/gm)].map((m) => m[1] as string);
  const found = verbs.filter((v) => /build|sample|ticket-run|run|pass/.test(v) && v !== "ticket-check");
  const server = readFileSync(join(CHECKOUT, "src", "serve", "server.ts"), "utf8");
  for (const m of server.matchAll(/"(\/api\/[^"]+)"/g))
    if (/build|sample|run/.test(m[1] as string)) found.push(m[1] as string);
  return found;
}

for (const step of ["19.1", "19.3", "19.4"]) {
  test(`${step} user path: a person can start a build pass on a ticket`, async () => {
    const project = freshProject();
    const paths = await userPaths(project);
    console.log(`${step} build/sample entry points found:`, JSON.stringify(paths));
    expect(paths.some((p) => /build/.test(p))).toBe(true);
  });
}

test("19.1 library: builder args in another project", () => {
  const project = freshProject();
  writeMap(project, THREE);
  const werk = currentWerk();
  const args = projectAgentArgs({ role: "builder", base: BASE, project: project.dir });
  const prompt = promptOf(args);
  const text = fillWerk(INSTRUCTIONS, werk).trimEnd();
  expect(prompt.startsWith(`${BASE}\n\n${text}\n\n${RULES_HEADING}\n`)).toBe(true);
  expect(text).toContain(`${werk} show`);
  expect(werk).toContain(
    CHECKOUT.replace(/\/\.werk-heldout\/\.\.$/, "")
      .split("/")
      .at(-1) as string,
  );
  expect(text).not.toMatch(/#(werk|st|lp|vi|pr|al|ms|how)-?[\w-]*\b/);
  for (const t of THREE.slice(2)) expect(prompt.slice(prompt.indexOf(RULES_HEADING))).toContain(t.title as string);
  const agents = JSON.parse(args[args.indexOf("--agents") + 1] as string);
  expect(Object.keys(agents).sort()).toEqual(["prototyper", "test-scope"]);
  for (const a of Object.values(agents)) expect((a as { prompt: string }).prompt).toContain(werk);
});

test("19.3 library: builder with an empty build-rules card", () => {
  const project = freshProject();
  writeMap(project, [{ id: "root" }, { id: "how", parent: "root" }]);
  const prompt = promptOf(projectAgentArgs({ role: "builder", base: BASE, project: project.dir }));
  expect(prompt).toContain(INSTR_HEAD);
  expect(prompt).not.toContain(RULES_HEADING);
});

test("19.4 library: builder in werk's own checkout", () => {
  const project = freshProject();
  writeMap(project, THREE);
  // The checkout itself is the project folder; its map is the temp log (the checkout has no .werk).
  const args = projectAgentArgs({
    role: "builder",
    base: BASE,
    project: CHECKOUT,
    log: join(project.dir, ".werk", "log.jsonl"),
  });
  const prompt = promptOf(args);
  // Claude Code loads the checkout's CLAUDE.md -> AGENTS.md -> @src/agent/instructions.md: one copy.
  const fromProjectFiles = readFileSync(join(CHECKOUT, "AGENTS.md"), "utf8").includes("@src/agent/instructions.md")
    ? 1
    : 0;
  const inPrompt = prompt.split(INSTR_HEAD).length - 1;
  console.log("19.4 copies in prompt:", inPrompt, "copies from project files:", fromProjectFiles);
  expect(inPrompt + fromProjectFiles).toBe(1);
  expect(prompt).toContain(RULES_HEADING);
  expect(prompt).toContain("A deploy is one tagged commit");
});

function send(port: number, path: string, method: string, headers: Record<string, string>, body?: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path, method, headers: { host: `localhost:${port}`, ...headers } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

test("19.2 chat agent through /api/chat gets the instructions and the rule titles; a sample has no user path", async () => {
  const project = freshProject();
  writeMap(project, THREE);
  process.env[FAKE_DIR_VAR] = project.env[FAKE_DIR_VAR];
  project.script({
    roles: {
      chat: {
        replies: [[{ event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "Hi." }] } } }]],
      },
    },
  });
  server = await startServer(join(project.dir, ".werk", "log.jsonl"), 0);
  const page = await send(server.port, "/map/root", "GET", {});
  const token = /<meta name="werk-token" content="([^"]+)">/.exec(page.body)?.[1] ?? "";
  const reply = await send(
    server.port,
    "/api/chat",
    "POST",
    { "content-type": "application/json", [TOKEN_HEADER]: token },
    JSON.stringify({ text: "hello" }),
  );
  expect(reply.status).toBe(200);
  const deadline = Date.now() + 10000;
  while (project.launches().length === 0 && Date.now() < deadline) await Bun.sleep(50);
  const launch = project.launches()[0];
  expect(launch?.role).toBe("chat");
  const chatPrompt = promptOf(launch?.args ?? []);
  expect(chatPrompt).toContain(INSTR_HEAD);
  expect(chatPrompt).toContain(RULES_HEADING);
  expect(chatPrompt).toContain("Money is stored in cents");

  // Library: what a sample launcher would pass.
  const sample = promptOf(projectAgentArgs({ role: "sample", base: "You sample.", project: project.dir }));
  console.log("19.2 library sample prompt:", JSON.stringify(sample));
  expect(sample).not.toContain(INSTR_HEAD);
  expect(sample).not.toContain(RULES_HEADING);

  // User path: a person samples options for an open card.
  const paths = await userPaths(project);
  console.log("19.2 build/sample entry points found:", JSON.stringify(paths));
  expect(paths.some((p) => /sample/.test(p))).toBe(true);
});
