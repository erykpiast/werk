// 19.1-19.4: the user-facing ways to start a build pass, a chat turn and a sample of options.
// The command line and the server are searched for an entry point; the chat pane's agent is
// started through the server's chat endpoint and its prompt read from the fake agent's launches.
import { afterEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { type Server, startServer, TOKEN_HEADER } from "../src/serve/server.ts";
import { FAKE_DIR_VAR } from "../src/test/fake-script.ts";
import { freshProject, type Project } from "../src/test/project.ts";

let server: Server | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
  delete process.env[FAKE_DIR_VAR];
});

type Reply = { status: number; body: string };
function send(port: number, path: string, method = "GET", headers: Record<string, string> = {}, body?: string) {
  return new Promise<Reply>((resolve, reject) => {
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

type Card = { id: string; parent?: string; title: string };
const RULES: Card[] = [
  { id: "root", title: "Root" },
  { id: "how", parent: "root", title: "How the shop is built" },
  { id: "db", parent: "how", title: "Tests run against a real database" },
  { id: "money", parent: "how", title: "Money is stored in cents" },
  { id: "deploy", parent: "how", title: "A deploy is one tagged commit" },
];

function seed(p: Project, cards: Card[]): void {
  const lines = cards.map(({ id, parent, title }, i) =>
    JSON.stringify({
      seq: i + 1,
      at: "t",
      actor: "you",
      type: "node.added",
      payload: { kind: "card", id, parent, title, status: "decided" },
    }),
  );
  writeFileSync(join(p.dir, ".werk", "log.jsonl"), `${lines.join("\n")}\n`);
}

const INSTR_HEAD = "# werk — how to work with the decision map";

/** The verb names in `werk help`. */
async function verbs(p: Project): Promise<string[]> {
  const help = await p.werk(["help"]);
  return [...help.out.matchAll(/^ {2}([a-z][a-z-]*)(?=\s|$)/gm)].map((m) => m[1] as string);
}

/** The server routes that start a build pass or a sample, if any: a POST that is not 404. */
async function serverRoute(port: number, token: string, names: string[]): Promise<string | undefined> {
  for (const name of names) {
    const r = await send(
      port,
      `/api/${name}`,
      "POST",
      { [TOKEN_HEADER]: token, "content-type": "application/json" },
      "{}",
    );
    if (r.status !== 404) return name;
  }
  return undefined;
}

async function startOn(p: Project): Promise<{ port: number; token: string }> {
  process.env[FAKE_DIR_VAR] = p.env[FAKE_DIR_VAR];
  server = await startServer(join(p.dir, ".werk", "log.jsonl"), 0);
  const page = await send(server.port, "/map/root");
  const token = /<meta name="werk-token" content="([^"]+)">/.exec(page.body)?.[1] ?? "";
  return { port: server.port, token };
}

const BUILD_NAMES = ["build", "pass", "build-pass", "ticket-build"];
const SAMPLE_NAMES = ["sample", "samples", "options"];

async function buildEntry(p: Project): Promise<string | undefined> {
  const v = (await verbs(p)).find((name) => BUILD_NAMES.includes(name));
  if (v !== undefined) return `verb ${v}`;
  const { port, token } = await startOn(p);
  const route = await serverRoute(port, token, BUILD_NAMES);
  return route === undefined ? undefined : `route /api/${route}`;
}

test("19.1", async () => {
  const p = freshProject();
  seed(p, RULES);
  // When the person starts a build pass on a ticket: look for any entry point.
  expect(await buildEntry(p), "no verb or server route starts a build pass").toBeDefined();
}, 60_000);

test("19.2", async () => {
  const p = freshProject();
  seed(p, RULES);
  p.script({
    roles: {
      chat: {
        replies: [[{ event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "ok" }] } } }]],
      },
    },
  });
  const { port, token } = await startOn(p);
  const r = await send(
    port,
    "/api/chat",
    "POST",
    { [TOKEN_HEADER]: token, "content-type": "application/json" },
    JSON.stringify({ text: "hi" }),
  );
  expect(r.status).toBe(200);
  const deadline = Date.now() + 20_000;
  while (p.launches().length === 0 && Date.now() < deadline) await Bun.sleep(50);
  const launch = p.launches()[0];
  expect(launch?.role).toBe("chat");
  const args = launch?.args ?? [];
  const prompt = args[args.indexOf("--append-system-prompt") + 1] ?? "";
  expect(prompt).toContain(INSTR_HEAD);
  for (const card of RULES.slice(2)) expect(prompt).toContain(card.title);
  // And the person samples options for an open card: look for any entry point.
  const v = (await verbs(p)).find((name) => SAMPLE_NAMES.includes(name));
  const route = await serverRoute(port, token, SAMPLE_NAMES);
  expect(v ?? route, "no verb or server route samples options").toBeDefined();
}, 60_000);

test("19.3", async () => {
  const p = freshProject();
  seed(p, RULES.slice(0, 2));
  expect(await buildEntry(p), "no verb or server route starts a build pass").toBeDefined();
}, 60_000);

test("19.4", async () => {
  // werk's own checkout: the entry point would be the same verb or route; none exists.
  const p = freshProject();
  writeFileSync(join(p.dir, "AGENTS.md"), "# Own\n\n@src/agent/instructions.md\n");
  seed(p, RULES);
  expect(await buildEntry(p), "no verb or server route starts a build pass").toBeDefined();
}, 60_000);
