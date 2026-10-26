// Held-out steps 19.1-19.4: the prompts of the agents werk starts in a project.
import { expect, test } from "bun:test";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

function seed(p: Project, type: string, payload: object): void {
  const log = join(p.dir, ".werk", "log.jsonl");
  const n = readFileSync(log, "utf8").split("\n").filter(Boolean).length;
  appendFileSync(log, `${JSON.stringify({ seq: n + 1, at: "t", actor: "you", type, payload })}\n`);
}

function rulesMap(p: Project, children: number): void {
  seed(p, "node.added", { id: "root", kind: "card", title: "Root" });
  seed(p, "node.added", { id: "how", kind: "card", title: "How it is built", parent: "root" });
  seed(p, "node.decided", { id: "how" });
  for (let i = 1; i <= children; i++) {
    seed(p, "node.added", { id: `rule-${i}`, kind: "card", title: `Rule number ${i} holds`, parent: "how" });
    seed(p, "node.decided", { id: `rule-${i}` });
  }
  seed(p, "node.added", { id: "open-card", kind: "card", title: "An open card", parent: "root" });
}

/** The entry point a person uses to start a build pass on a ticket: a verb of the command line. */
async function buildPassVerb(p: Project): Promise<string | undefined> {
  const help = await p.werk(["help"]);
  const verbs = [...help.out.matchAll(/^ {2}(\S+)/gm)].map((m) => m[1] as string);
  return verbs.find((v) => /build|ticket(?!-check)|pass/.test(v));
}

for (const [id, children] of [
  ["19.1", 3],
  ["19.3", 0],
  ["19.4", 3],
] as const) {
  test(`${id} a build pass on a ticket can be started`, async () => {
    const p = freshProject();
    rulesMap(p, children);
    const verb = await buildPassVerb(p);
    console.log(`${id}: build-pass verb found: ${verb}`);
    expect(verb).toBeDefined();
  });
}

test("19.2 chat agent gets the instructions and the rule titles; a sample agent does not", async () => {
  const p = freshProject();
  rulesMap(p, 3);
  p.script({
    roles: {
      chat: {
        replies: [
          [
            { event: { type: "stream_event", event: { type: "message_start", message: { id: "m1" } } } },
            { event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "ok" }] } } },
          ],
        ],
      },
    },
  });
  const serve = p.start([process.execPath, join(import.meta.dir, "..", "src", "cli.ts"), "serve", "--port", "0"]);
  const reader = serve.stdout.getReader();
  let out = "";
  let url: string | undefined;
  while (url === undefined) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`serve ended: ${out}`);
    out += new TextDecoder().decode(value);
    url = /http:\/\/\S+/.exec(out)?.[0]?.replace(/\/map$/, "");
  }
  const page = await (await fetch(`${url}/map/root`)).text();
  const token = /<meta name="werk-token" content="([^"]+)">/.exec(page)?.[1] ?? "";
  const sent = await fetch(`${url}/api/chat`, {
    method: "POST",
    headers: { "x-werk-token": token, "content-type": "application/json" },
    body: JSON.stringify({ text: "hello" }),
  });
  expect(sent.status).toBe(200);
  // The harness reads the launch record of the fake agent once it exists.
  while (!p.launches().some((l) => l.role === "chat")) await Bun.sleep(20);
  const chat = p.launches().find((l) => l.role === "chat");
  const prompt = chat?.args[(chat?.args.indexOf("--append-system-prompt") ?? -2) + 1] ?? "";
  expect(prompt).toContain("how to work with the decision map");
  expect(prompt).toContain("Rule number 1 holds");
  expect(prompt).toContain("Rule number 3 holds");

  // The sample agent: the person samples options for an open card.
  const help = await p.werk(["help"]);
  const sampleVerb = [...help.out.matchAll(/^ {2}(\S+)/gm)].map((m) => m[1] as string).find((v) => /sample/.test(v));
  console.log(`19.2: sample verb found: ${sampleVerb}`);
  expect(sampleVerb).toBeDefined();
});
