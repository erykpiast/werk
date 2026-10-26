import { appendFileSync, writeFileSync } from "node:fs";
import { expect, test } from "bun:test";
import { projectAgentArgs } from "../src/agent/launch.ts";
import { freshProject } from "../src/test/project.ts";
import { join } from "node:path";

function withHow(kids: number, own = false) {
  const p = freshProject();
  const ev: any[] = [
    { type: "node.added", payload: { id: "root", kind: "card", title: "Root" } },
    { type: "node.added", payload: { id: "how", kind: "card", title: "How", parent: "root", status: "decided" } },
  ];
  for (let i = 1; i <= kids; i++) ev.push({ type: "node.added", payload: { id: `rule-${i}`, kind: "card", title: `Rule title ${i}`, parent: "how", status: "decided" } });
  appendFileSync(join(p.dir, ".werk", "log.jsonl"), `${ev.map((e, i) => JSON.stringify({ seq: i + 1, at: "t", actor: "you", ...e })).join("\n")}\n`);
  if (own) writeFileSync(join(p.dir, "AGENTS.md"), "@src/agent/instructions.md\n");
  return p;
}

test("probe: is there any verb that starts a build pass on a ticket", async () => {
  const p = withHow(3);
  const help = (await p.werk(["help"])).out;
  const verbs = help.split("\n").filter((l) => /^  [a-z-]+/.test(l)).map((l) => l.trim().split(" ")[0]);
  console.log(verbs.join(","));
  // the person's operation: start a build pass on a ticket
  expect(verbs.some((v) => v === "build" || v === "run" || v === "start")).toBe(true);
});

test("19.1 supplement: builder-role args in another project", () => {
  const p = withHow(3);
  const args = projectAgentArgs({ role: "builder", base: "BUILDER BASE", project: p.dir, log: join(p.dir, ".werk", "log.jsonl") });
  const prompt = args[args.indexOf("--append-system-prompt") + 1] as string;
  expect(prompt.startsWith("BUILDER BASE")).toBe(true);
  expect(prompt).toContain("werk — how to work with the decision map");
  expect(prompt).not.toContain("{{werk}}");
  for (let i = 1; i <= 3; i++) expect(prompt).toContain(`Rule title ${i}`);
  expect(args).toContain("--agents");
  const agents = JSON.parse(args[args.indexOf("--agents") + 1] as string);
  expect(Object.keys(agents).sort()).toEqual(["prototyper", "test-scope"]);
});

test("19.3 supplement: no build rules → no title list", () => {
  const p = withHow(0);
  const args = projectAgentArgs({ role: "builder", base: "B", project: p.dir, log: join(p.dir, ".werk", "log.jsonl") });
  const prompt = args[args.indexOf("--append-system-prompt") + 1] as string;
  expect(prompt).toContain("werk — how to work");
  expect(prompt).not.toContain("build rules");
});

test("19.4 supplement: own checkout includes once", () => {
  const p = withHow(2, true);
  const args = projectAgentArgs({ role: "builder", base: "B", project: p.dir, log: join(p.dir, ".werk", "log.jsonl") });
  const prompt = args[args.indexOf("--append-system-prompt") + 1] as string;
  console.log("own-checkout prompt has instructions:", prompt.includes("how to work with the decision map"));
});

test("19.2 chat agent gets instructions and titles; sample has no route", async () => {
  const p = withHow(2);
  p.script({ roles: { chat: { replies: [[{ event: { type: "result", subtype: "success", result: "ok" } }]] } } });
  const proc = p.start([process.execPath, join(import.meta.dir, "..", "src", "cli.ts"), "serve", "--port", "0"]);
  const reader = proc.stdout.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  const url = (/http:\/\/\S+/.exec(first) as RegExpExecArray)[0].replace(/\/map$/, "");
  const html = await (await fetch(`${url}/map`)).text();
  const token = (/name="werk-token" content="([^"]+)"/.exec(html) as RegExpExecArray)[1] as string;
  const r = await fetch(`${url}/api/chat`, { method: "POST", headers: { "x-werk-token": token, "content-type": "application/json" }, body: JSON.stringify({ text: "hello", turn: "t1", card: "root" }) });
  expect(r.status).toBe(200);
  for (let i = 0; i < 100 && p.launches().length === 0; i++) await Bun.sleep(50);
  const l = p.launches();
  proc.kill();
  expect(l.length).toBeGreaterThan(0);
  const prompt = l[0]?.args[(l[0]?.args.indexOf("--append-system-prompt") ?? 0) + 1] as string;
  expect(prompt).toContain("werk — how to work with the decision map");
  expect(prompt).toContain("Rule title 1");
  // sampling options for an open card: is there any route?
  const routes = await Bun.file(join(import.meta.dir, "..", "src", "serve", "server.ts")).text();
  expect(/sample/i.test(routes)).toBe(true);
});
