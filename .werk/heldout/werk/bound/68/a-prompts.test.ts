// Held-out steps 19.1-19.4. werk has no command that starts a build pass or a sample agent, so these
// steps read the arguments that werk's launcher gives an agent of that role (projectAgentArgs). The
// chat agent of 19.2 is started for real through the server, with the fake agent on PATH.
import { afterEach, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { dirname, join } from "node:path";
import { projectAgentArgs } from "../src/agent/launch.ts";
import { fillWerk, INSTRUCTIONS } from "../src/agent/prompt.ts";
import { type Server, startServer, TOKEN_HEADER } from "../src/serve/server.ts";
import { FAKE_DIR_VAR } from "../src/test/fake-script.ts";
import { freshProject, type Project } from "../src/test/project.ts";

const CHECKOUT = dirname(import.meta.dir);
const WERK = `${process.execPath} ${join(CHECKOUT, "src", "cli.ts")}`;
const BASE = "You are the build agent. Build the ticket below.";
const RULES_HEADING = "## This project's build rules";
const promptOf = (args: string[]) => args[args.indexOf("--append-system-prompt") + 1] as string;

type Card = { id: string; parent?: string; title?: string; status?: string };
function writeMap(project: Project, cards: Card[]): void {
  const lines = cards.map(({ id, parent, title, status }, i) =>
    JSON.stringify({
      seq: i + 1,
      at: "t",
      type: "node.added",
      actor: "you",
      payload: { kind: "card", id, parent, title: title ?? `Title of ${id}`, status: status ?? "decided", who: "me" },
    }),
  );
  writeFileSync(join(project.dir, ".werk", "log.jsonl"), `${lines.join("\n")}\n`);
}
const RULES: Card[] = [
  { id: "root", title: "Shop" },
  { id: "how", parent: "root", title: "How the shop is built" },
  { id: "db", parent: "how", title: "Tests run against a real database" },
  { id: "money", parent: "how", title: "Money is stored in cents" },
  { id: "deploy", parent: "how", title: "A deploy is one tagged commit" },
];
const TITLES = ["Tests run against a real database", "Money is stored in cents", "A deploy is one tagged commit"];

let server: Server | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
  delete process.env[FAKE_DIR_VAR];
});

test("19.1 build pass in another project", () => {
  const project = freshProject();
  writeMap(project, RULES);
  const args = projectAgentArgs({ role: "builder", base: BASE, project: project.dir }, WERK);
  const prompt = promptOf(args);
  const text = fillWerk(INSTRUCTIONS, WERK).trimEnd();
  expect(prompt.startsWith(BASE)).toBe(true);
  expect(prompt.slice(BASE.length).trimStart().startsWith(text)).toBe(true);
  expect(text).toContain(`${WERK} `);
  expect(text).not.toContain("{{werk}}");
  // No card id of werk's own map appears in the instructions.
  const ownIds = ["werk-test", "werk-devex", "werk-stack", "werk-cc", "werk-checks", "werk-agent-instructions", "how"];
  for (const id of ownIds) expect(text).not.toContain(`#${id}`);
  const after = prompt.slice(prompt.indexOf(text) + text.length);
  expect(after).toContain(RULES_HEADING);
  for (const title of TITLES) expect(after).toContain(title);
  const agents = JSON.parse(args[args.indexOf("--agents") + 1] as string) as Record<string, { prompt: string }>;
  expect(Object.keys(agents).sort()).toEqual(["prototyper", "test-scope"]);
  for (const agent of Object.values(agents)) expect(agent.prompt).toContain(CHECKOUT);
});

function send(port: number, path: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path, method: options.method ?? "GET", headers: { host: `localhost:${port}`, ...options.headers } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });
}

test("19.2 chat agent gets the instructions, a sample agent does not", async () => {
  const project = freshProject();
  writeMap(project, [...RULES, { id: "open-q", parent: "root", title: "Which payment provider", status: "open" }]);
  process.env[FAKE_DIR_VAR] = project.env[FAKE_DIR_VAR];
  project.script({
    roles: { chat: { replies: [[{ event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "ok" }] } } }]] } },
  });
  server = await startServer(join(project.dir, ".werk", "log.jsonl"), 0);
  const page = await send(server.port, "/map/root");
  const token = /<meta name="werk-token" content="([^"]+)">/.exec(page.body)?.[1] ?? "";
  const reply = await send(server.port, "/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", [TOKEN_HEADER]: token },
    body: JSON.stringify({ text: "hello" }),
  });
  expect(reply.status).toBe(200);
  const deadline = Date.now() + 5000;
  while (project.launches().length === 0 && Date.now() < deadline) await Bun.sleep(20);
  const launch = project.launches()[0];
  expect(launch?.role).toBe("chat");
  const chatPrompt = promptOf(launch?.args ?? []);
  expect(chatPrompt).toContain("# werk — how to work with the decision map");
  expect(chatPrompt).toContain(RULES_HEADING);
  for (const title of TITLES) expect(chatPrompt).toContain(title);

  // No launcher of a sample agent exists; read the arguments werk gives the sample role.
  const sample = promptOf(projectAgentArgs({ role: "sample", base: "You sample options.", project: project.dir }, WERK));
  expect(sample).not.toContain("# werk — how to work with the decision map");
  expect(sample).not.toContain(RULES_HEADING);
  for (const title of TITLES) expect(sample).not.toContain(title);
});

test("19.3 no build rules, no title list", () => {
  const project = freshProject();
  writeMap(project, [{ id: "root" }, { id: "how", parent: "root", title: "How it is built" }]);
  const prompt = promptOf(projectAgentArgs({ role: "builder", base: BASE, project: project.dir }, WERK));
  expect(prompt).toContain(fillWerk(INSTRUCTIONS, WERK).trimEnd());
  expect(prompt).not.toContain(RULES_HEADING);
});

test("19.4 in werk's own checkout the instructions appear once", () => {
  const project = freshProject();
  writeMap(project, RULES);
  writeFileSync(join(project.dir, "AGENTS.md"), readFileSync(join(CHECKOUT, "AGENTS.md"), "utf8"));
  const prompt = promptOf(projectAgentArgs({ role: "builder", base: BASE, project: project.dir }, WERK));
  const marker = "# werk — how to work with the decision map";
  // The agent reads AGENTS.md (which includes the instructions) itself; the prompt must not add a second copy.
  const inPrompt = prompt.split(marker).length - 1;
  expect(inPrompt).toBeLessThanOrEqual(1);
  const agentsMdCopies = readFileSync(join(project.dir, "AGENTS.md"), "utf8").includes("@src/agent/instructions.md") ? 1 : 0;
  expect(inPrompt + agentsMdCopies).toBe(1);
  expect(prompt).toContain(RULES_HEADING);
  for (const title of TITLES) expect(prompt).toContain(title);
});
