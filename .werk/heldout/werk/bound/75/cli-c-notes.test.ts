// Held-out steps 68.1-68.5: say, show and inbox.
import { expect, test } from "bun:test";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
const lines = (p: Project) =>
  readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((l) => l !== "");

function seed(p: Project, type: string, payload: object) {
  const seq = lines(p).length + 1;
  appendFileSync(logOf(p), `${JSON.stringify({ seq, at: "t", actor: "you", type, payload })}\n`);
}

async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
  return run;
}

function base(): Project {
  const p = freshProject();
  seed(p, "node.added", { id: "root", kind: "card", title: "Root" });
  seed(p, "node.added", {
    id: "werk-chat",
    kind: "card",
    title: "The composer sends a live agent turn",
    why: "W",
    status: "decided",
    who: "me",
    parent: "root",
  });
  return p;
}

/** The inbox output split into groups by `#id` header lines. */
function groups(out: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of out.split("\n")) {
    const head = /#([\w:.-]+)/.exec(line);
    if (head !== null && /^\S/.test(line)) {
      const id = head[1] as string;
      current = result.get(id) ?? [];
      result.set(id, current);
    } else if (current !== undefined && line.trim() !== "") current.push(line.trim());
  }
  return result;
}

test("68.1", async () => {
  const p = base();
  const before = lines(p).length;
  const r = await p.werk(["say", "#werk-chat", "The reply streams over SSE"]);
  expect(r.code).toBe(0);
  const after = lines(p);
  expect(after.length).toBe(before + 1);
  const ev = JSON.parse(after.at(-1) as string);
  expect(ev.type).toBe("note.added");
  expect(ev.payload.id).toBe("werk-chat");
  const show = await ok(p, ["show", "#werk-chat"]);
  console.log("68.1 show:", show.out);
  expect(show.out).toContain("The reply streams over SSE");
});

test("68.2", async () => {
  const p = base();
  for (const t of ["first", "second", "third"]) await ok(p, ["say", "#werk-chat", t]);
  const inbox = await ok(p, ["inbox"]);
  console.log("68.2 inbox:", JSON.stringify(inbox.out));
  const g = groups(inbox.out);
  expect(g.has("werk-chat")).toBe(true);
  expect(g.get("werk-chat")).toEqual(["first", "second", "third"]);
});

test("68.3", async () => {
  const p = base();
  seed(p, "node.added", { id: "visual", kind: "card", title: "Visual", parent: "root" });
  await ok(p, ["say", "#werk-chat", "chat one"]);
  await ok(p, ["say", "#visual", "visual one"]);
  await ok(p, ["say", "#werk-chat", "chat two"]);
  const inbox = await ok(p, ["inbox"]);
  console.log("68.3 inbox:", JSON.stringify(inbox.out));
  const g = groups(inbox.out);
  expect(g.get("werk-chat")).toEqual(["chat one", "chat two"]);
  expect(g.get("visual")).toEqual(["visual one"]);
});

test("68.4", async () => {
  const p = base();
  seed(p, "node.added", { id: "visual", kind: "card", title: "Visual", parent: "root" });
  await ok(p, ["add", "werk-pane", "--title", "The pane", "--parent", "root"]);
  await ok(p, ["link", "visual", "werk-pane", "--type", "depends_on", "--why", "visual draws the pane"]);
  const r = await p.werk(["say", "#werk-pane", "Describe the pane here"]);
  expect(r.code).toBe(0);
  const inbox = await ok(p, ["inbox"]);
  console.log("68.4 inbox:", JSON.stringify(inbox.out));
  expect(groups(inbox.out).get("werk-pane")).toEqual(["Describe the pane here"]);
});

test("68.5", async () => {
  const p = base();
  const before = readFileSync(logOf(p), "utf8");
  const r = await p.werk(["say", "#no-such-card", "lost note"]);
  console.log("68.5:", r);
  expect(r.code).not.toBe(0);
  expect(`${r.out}${r.err}`).toContain("no-such-card");
  expect(`${r.out}${r.err}`).toContain("unknown");
  expect(readFileSync(logOf(p), "utf8")).toBe(before);
  const inbox = await ok(p, ["inbox"]);
  expect(inbox.out).not.toContain("lost note");
});
