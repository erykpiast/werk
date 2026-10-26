// Held-out steps 19.1–19.4: the prompts of the agents that werk starts.
import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { INSTRUCTIONS } from "../src/agent/prompt.ts";
import { readMap, write } from "../src/map/store.ts";
import type { Draft } from "../src/map/types.ts";
import { type Server, startServer, TOKEN_HEADER } from "../src/serve/server.ts";
import { FAKE_DIR_VAR } from "../src/test/fake-script.ts";
import { freshProject, type Project } from "../src/test/project.ts";

let server: Server | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
  delete process.env[FAKE_DIR_VAR];
});

const card = (id: string, title: string, parent?: string, status = "decided"): Draft => ({
  type: "node.added",
  actor: "you",
  payload: { id, kind: "card", title, status, who: "me", ...(parent === undefined ? {} : { parent }) },
});

function seed(project: Project, drafts: Draft[]): string {
  const log = join(project.dir, ".werk", "log.jsonl");
  write(readMap("test", log), drafts, log);
  return log;
}

const RULES = [
  card("root", "Root"),
  card("how", "How it is built"),
  card("rule-a", "Rule alpha holds", "how"),
  card("rule-b", "Rule beta holds", "how"),
  card("rule-c", "Rule gamma holds", "how"),
];

/** The first lines of the werk agent instructions, with the command line still a placeholder. */
const HEAD = INSTRUCTIONS.split("\n")[0] as string;

/** Starts a build pass on a ticket from the command line, the only place a person could start one. */
async function buildPass(project: Project): Promise<{ code: number; err: string; prompt: string | undefined }> {
  project.script({ roles: { builder: { replies: [[]] } } });
  const run = await project.werk(["build", "ticket-1"]);
  const launch = project.launches().find((each) => each.role === "builder");
  const at = launch?.args.indexOf("--append-system-prompt") ?? -1;
  return { code: run.code, err: run.err, prompt: at < 0 ? undefined : launch?.args[at + 1] };
}

test("19.1 a build pass in another project starts with the instructions, subagents and rule titles", async () => {
  const project = freshProject();
  seed(project, RULES);
  const { code, err, prompt } = await buildPass(project);
  expect({ code, err }).toEqual({ code: 0, err: "" });
  expect(prompt).toBeDefined();
  const text = prompt as string;
  expect(text.indexOf(HEAD)).toBeGreaterThan(0);
  expect(text).toContain("Rule alpha holds");
  expect(text.indexOf("Rule alpha holds")).toBeGreaterThan(text.indexOf(HEAD));
});

test("19.2 a chat agent gets the instructions, but a sample agent does not", async () => {
  const project = freshProject();
  process.env[FAKE_DIR_VAR] = project.env[FAKE_DIR_VAR];
  const log = seed(project, RULES);
  project.script({ roles: { chat: { replies: [[{ event: { type: "result", subtype: "success", result: "ok" } }]] } } });
  server = await startServer(log, 0);
  const port = server.port;
  const get = (path: string, method = "GET", body?: string, headers: Record<string, string> = {}) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port, path, method, headers: { host: `localhost:${port}`, ...headers } },
        (res) => {
          let text = "";
          res.on("data", (c: Buffer) => {
            text += c.toString();
          });
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text }));
        },
      );
      req.on("error", reject);
      req.end(body);
    });
  const page = await get("/map/root");
  const token = /<meta name="werk-token" content="([^"]+)">/.exec(page.body)?.[1] ?? "";
  const sent = await get("/api/chat", "POST", JSON.stringify({ text: "hello" }), {
    "content-type": "application/json",
    [TOKEN_HEADER]: token,
  });
  expect(sent.status).toBe(200);
  const deadline = Date.now() + 5000;
  while (!project.launches().some((each) => each.role === "chat") && Date.now() < deadline) await Bun.sleep(50);
  const chat = project.launches().find((each) => each.role === "chat");
  expect(chat).toBeDefined();
  const chatPrompt = chat?.args[(chat?.args.indexOf("--append-system-prompt") ?? -1) + 1] ?? "";
  expect(chatPrompt).toContain(HEAD);
  expect(chatPrompt).toContain("Rule alpha holds");

  // The person samples options for an open card: werk has to offer a way to start it.
  seed(project, [card("open-one", "An open card", "root", "open")]);
  project.script({ roles: { sample: { replies: [[]] } } });
  const sample = await project.werk(["sample", "open-one"]);
  expect(sample.code).toBe(0);
  const launch = project.launches().find((each) => each.role === "sample");
  expect(launch).toBeDefined();
  const samplePrompt = launch?.args.join("\n") ?? "";
  expect(samplePrompt).not.toContain(HEAD);
  expect(samplePrompt).not.toContain("Rule alpha holds");
});

test("19.3 a project with no build rules gets no title list", async () => {
  const project = freshProject();
  seed(project, [card("root", "Root"), card("how", "How it is built")]);
  const { code, prompt } = await buildPass(project);
  expect(code).toBe(0);
  expect(prompt).toContain(HEAD);
  expect(prompt).not.toContain("This project's build rules");
});

test("19.4 in werk's own checkout the instructions appear one time", async () => {
  const project = freshProject();
  seed(project, RULES);
  const agents = readFileSync(join(import.meta.dir, "..", "AGENTS.md"), "utf8");
  await Bun.write(join(project.dir, "AGENTS.md"), agents);
  const { code, prompt } = await buildPass(project);
  expect(code).toBe(0);
  const text = prompt ?? "";
  // The prompt holds the instructions once: the include line of AGENTS.md, or the text itself.
  const count = text.split(HEAD).length - 1 + (text.split("@src/agent/instructions.md").length - 1);
  expect(count).toBe(1);
  expect(text.indexOf("Rule alpha holds")).toBeGreaterThan(-1);
});
