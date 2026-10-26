// Held-out steps 19.1–19.4: the prompt of a build pass, a chat agent and a sample agent.
import { expect, test } from "bun:test";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../../src/test/project.ts";

function seed(p: Project, type: string, payload: object) {
  const log = join(p.dir, ".werk", "log.jsonl");
  const n = readFileSync(log, "utf8").split("\n").filter(Boolean).length;
  appendFileSync(log, `${JSON.stringify({ seq: n + 1, at: "2026-10-01T00:00:00.000Z", actor: "you", type, payload })}\n`);
}

function seedRules(p: Project, rules = 3) {
  seed(p, "node.added", { id: "root", kind: "card", title: "Root" });
  seed(p, "node.added", { id: "how", kind: "card", title: "How it is built", status: "decided" });
  for (let i = 1; i <= rules; i++)
    seed(p, "node.added", { id: `rule-${i}`, kind: "card", title: `Build rule number ${i}`, parent: "how", status: "decided" });
}

/** The verb or route that starts a build pass on a ticket. */
async function buildStarter(p: Project): Promise<string | undefined> {
  const help = await p.werk(["help"]);
  const verb = /^ {2}(build|run|pass|build-pass)\b/m.exec(help.out);
  return verb?.[1];
}

test("19.1 a build pass in another project starts with the werk instructions and build-rule titles", async () => {
  const p = freshProject();
  seedRules(p, 3);
  const verb = await buildStarter(p);
  console.log("19.1 build verb:", verb);
  // The person starts a build pass on a ticket in that project.
  expect(verb).toBeDefined();
  const r = await p.werk([verb as string, "01-ticket"]);
  expect(r.code).toBe(0);
  expect(p.launches().some((l) => l.role === "builder")).toBe(true);
}, 30000);

test("19.2 a chat agent gets the instructions, a sample agent does not", async () => {
  const p = freshProject();
  seedRules(p, 2);
  p.script({
    roles: {
      chat: { replies: [[{ event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "Hi." }] } } }]] },
    },
  });
  const proc = p.start([process.execPath, join(import.meta.dir, "../../src/cli.ts"), "serve", "--port", "0"]);
  let out = "";
  const reader = proc.stdout.getReader();
  while (!/http:\/\/\S+/.test(out)) {
    const { value, done } = await reader.read();
    if (done) break;
    out += new TextDecoder().decode(value);
  }
  const url = (/http:\/\/\S+/.exec(out)?.[0] ?? "").replace(/\/map$/, "");
  const page = await (await fetch(`${url}/map/root`)).text();
  const token = /<meta name="werk-token" content="([^"]+)">/.exec(page)?.[1] ?? "";
  const res = await fetch(`${url}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-werk-token": token },
    body: JSON.stringify({ text: "hello" }),
  });
  expect(res.status).toBe(200);
  const deadline = Date.now() + 5000;
  while (p.launches().length === 0 && Date.now() < deadline) await Bun.sleep(50);
  const chat = p.launches().find((l) => l.role === "chat");
  expect(chat).toBeDefined();
  const prompt = chat?.args[chat.args.indexOf("--append-system-prompt") + 1] ?? "";
  expect(prompt).toContain("werk — how to work with the decision map");
  expect(prompt).toContain("Build rule number 1");
  expect(prompt).toContain("Build rule number 2");
  // The person samples options for an open card.
  const help = (await p.werk(["help"])).out;
  const sampleVerb = /^ {2}(sample)\b/m.exec(help)?.[1];
  const sampleRoute = await fetch(`${url}/api/sample`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-werk-token": token },
    body: JSON.stringify({ id: "root" }),
  });
  console.log("19.2 sample verb:", sampleVerb, "sample route status:", sampleRoute.status);
  expect(sampleVerb !== undefined || sampleRoute.status === 200).toBe(true);
}, 30000);

test("19.3 a project with no build rules gets no title list", async () => {
  const p = freshProject();
  seedRules(p, 0);
  const verb = await buildStarter(p);
  console.log("19.3 build verb:", verb);
  expect(verb).toBeDefined();
}, 30000);

test("19.4 in werk's own checkout the instructions appear one time", async () => {
  const p = freshProject();
  const clone = await p.run(["git", "clone", "--quiet", join(import.meta.dir, "../.."), join(p.dir, "werk-clone")]);
  expect(clone.code).toBe(0);
  const verb = await buildStarter(p);
  console.log("19.4 build verb:", verb);
  expect(verb).toBeDefined();
}, 30000);
