// Remove, restore and removed at the command-line seam (#werk-v0-seams), on a fresh project whose
// log holds an accepted map, read back through the log file and through show.
import { expect, test } from "bun:test";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../test/project.ts";

const logOf = (project: Project) => join(project.dir, ".werk", "log.jsonl");
const lines = (project: Project) =>
  readFileSync(logOf(project), "utf8")
    .split("\n")
    .filter((line) => line !== "");

type Payload = Record<string, unknown>;

/** A project whose log holds real nodes and links, as a person's accepted map would. */
function withMap(events: [type: string, payload: Payload][]): Project {
  const project = freshProject();
  const text = events.map(([type, payload], i) => JSON.stringify({ seq: i + 1, at: "t", actor: "you", type, payload }));
  appendFileSync(logOf(project), `${text.join("\n")}\n`);
  return project;
}
const card = (id: string, title: string, parent?: string): [string, Payload] => [
  "node.added",
  { id, kind: "card", title, ...(parent === undefined ? {} : { parent }) },
];
const link = (from: string, to: string, type: string, why?: string): [string, Payload] => [
  "edge.added",
  { from, to, type, ...(why === undefined ? {} : { why }) },
];

async function ok(project: Project, args: string[]) {
  const run = await project.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
  return run;
}

// root
//  ├ auth "Login is by magic link"
//  │  ├ auth-mail "The link is sent by mail"
//  │  └ auth-expiry "The link expires after ten minutes"
//  └ billing "We charge per seat"  (depends_on auth-mail)
const tree = () =>
  withMap([
    card("root", "Root"),
    card("auth", "Login is by magic link", "root"),
    card("auth-mail", "The link is sent by mail", "auth"),
    card("auth-expiry", "The link expires after ten minutes", "auth"),
    card("billing", "We charge per seat", "root"),
    link("billing", "auth-mail", "depends_on", "Billing mails the invoice the same way"),
  ]);

test("removing a card with two children removes three cards in one event, and a restore brings all three back with their links", async () => {
  const project = tree();
  const before = (await ok(project, ["show", "billing"])).out;
  const count = lines(project).length;
  const removed = await ok(project, ["remove", "#auth", "--actor", "you"]);
  expect(removed.out).toBe(
    "auth: removed\n  and auth-mail  The link is sent by mail\n  and auth-expiry  The link expires after ten minutes\n",
  );
  expect(lines(project)).toHaveLength(count + 1);
  expect(JSON.parse(lines(project).at(-1) as string)).toMatchObject({
    actor: "you",
    type: "node.removed",
    payload: { id: "auth" },
  });
  for (const id of ["auth", "auth-mail", "auth-expiry"]) expect((await project.werk(["show", id])).code).toBe(1);
  expect((await ok(project, ["show", "billing"])).out).not.toContain("auth-mail");
  expect((await ok(project, ["show", "root"])).out).not.toContain("auth");
  expect((await ok(project, ["removed"])).out).toBe(removed.out);
  const restored = await ok(project, ["restore", "auth", "--actor", "you"]);
  expect(restored.out).toBe(removed.out.replace("removed", "restored"));
  expect(lines(project)).toHaveLength(count + 2);
  expect((await ok(project, ["show", "billing"])).out).toBe(before);
  expect((await ok(project, ["show", "auth-mail"])).out).toContain("parent: auth  Login is by magic link");
  expect((await ok(project, ["removed"])).out).toBe("no card is removed\n");
});

test("remove with reparent moves the children to the grandparent, and a restore puts them back under the card", async () => {
  const project = tree();
  const removed = await ok(project, ["remove", "auth", "--reparent", "--actor", "you"]);
  expect(removed.out).toBe(
    "auth: removed\n" +
      "  moved auth-mail  The link is sent by mail  up to root\n" +
      "  moved auth-expiry  The link expires after ten minutes  up to root\n",
  );
  expect((await ok(project, ["show", "auth-mail"])).out).toContain("parent: root  Root");
  expect((await ok(project, ["show", "auth-expiry"])).out).toContain("parent: root  Root");
  expect((await project.werk(["show", "auth"])).code).toBe(1);
  const restored = await ok(project, ["restore", "auth", "--actor", "you"]);
  expect(restored.out).toBe(
    "auth: restored\n" +
      "  moved auth-mail  The link is sent by mail  back under auth\n" +
      "  moved auth-expiry  The link expires after ten minutes  back under auth\n",
  );
  expect((await ok(project, ["show", "auth-mail"])).out).toContain("parent: auth  Login is by magic link");
  expect((await ok(project, ["show", "auth-expiry"])).out).toContain("parent: auth  Login is by magic link");
  expect((await ok(project, ["show", "root"])).out).not.toContain("auth-mail");
});

test("removing login, then session, then restoring login keeps the link between them out until session is restored", async () => {
  const project = withMap([
    card("root", "Root"),
    card("login", "Login is by magic link", "root"),
    card("session", "A session lasts a day", "root"),
    link("login", "session", "depends_on", "Login opens a session"),
  ]);
  const linked = "  -> depends_on      session  A session lasts a day\n       why: Login opens a session\n";
  await ok(project, ["remove", "login", "--actor", "you"]);
  await ok(project, ["remove", "session", "--actor", "you"]);
  await ok(project, ["restore", "login", "--actor", "you"]);
  expect((await ok(project, ["show", "login"])).out).not.toContain("depends_on");
  expect((await ok(project, ["removed"])).out).toBe("session: removed\n");
  await ok(project, ["restore", "session", "--actor", "you"]);
  expect((await ok(project, ["show", "login"])).out).toContain(linked);
});

test("adding a card with a removed card's id is refused and names the restore", async () => {
  const project = tree();
  await ok(project, ["remove", "auth", "--actor", "you"]);
  const count = lines(project).length;
  const again = await project.werk(["add", "auth-mail", "--title", "Mail is the only channel", "--parent", "root"]);
  expect(again).toMatchObject({
    code: 1,
    err: "werk add: refused: #auth-mail is removed, and its id stays taken; restore #auth to bring it back\n",
  });
  expect(lines(project)).toHaveLength(count);
});

test("a source cited by a remaining card stays after the removal, and one only the branch cites goes", async () => {
  const project = withMap([
    card("root", "Root"),
    card("auth", "Login is by magic link", "root"),
    card("billing", "We charge per seat", "root"),
    ["node.added", { id: "survey", kind: "source", title: "Pricing survey" }],
    ["node.added", { id: "study", kind: "source", title: "Login study" }],
    ["node.added", { id: "auth:opt0", kind: "option", title: "Passwords", why_not: "Users forget them" }],
    link("auth", "survey", "supported_by"),
    link("billing", "survey", "supported_by"),
    link("auth", "study", "supported_by"),
    link("auth:opt0", "auth", "alternative_to"),
  ] as [string, Payload][]);
  const removed = await ok(project, ["remove", "auth", "--actor", "you"]);
  expect(removed.out).toBe("auth: removed\n  and auth:opt0  Passwords\n  and study  Login study\n");
  expect((await ok(project, ["show", "survey"])).out).toContain("  <- supported_by    billing  We charge per seat\n");
  expect((await ok(project, ["show", "survey"])).out).not.toContain("auth");
  for (const id of ["auth:opt0", "study"]) expect((await project.werk(["show", id])).code).toBe(1);
  await ok(project, ["restore", "auth", "--actor", "you"]);
  const auth = (await ok(project, ["show", "auth"])).out;
  expect(auth).toContain("  -> supported_by    survey  Pricing survey\n");
  expect(auth).toContain("  -> supported_by    study  Login study\n");
  expect(auth).toContain("  <- alternative_to  auth:opt0  Passwords\n");
});

test("remove and restore without --actor you refuse and append nothing", async () => {
  const project = tree();
  const before = lines(project);
  for (const args of [
    ["remove", "auth"],
    ["remove", "auth", "--actor", "agent"],
    ["restore", "auth"],
  ]) {
    const run = await project.werk(args);
    expect(run.code).toBe(1);
    expect(run.err).toContain("pass --actor you");
  }
  expect(lines(project)).toEqual(before);
  await ok(project, ["remove", "auth", "--actor", "you"]);
  const removed = lines(project);
  expect((await project.werk(["restore", "auth", "--actor", "agent"])).code).toBe(1);
  expect(lines(project)).toEqual(removed);
});

test("a restore names the removal: a card that went out with another, or that sits under one still out, is refused", async () => {
  const project = tree();
  await ok(project, ["remove", "auth-mail", "--actor", "you"]);
  await ok(project, ["remove", "auth", "--actor", "you"]);
  const count = lines(project).length;
  expect(await project.werk(["restore", "auth-mail", "--actor", "you"])).toMatchObject({
    code: 1,
    err: "werk restore: refused: #auth-mail sits under #auth, which is out of the map: #auth is removed; restore #auth first\n",
  });
  expect(await project.werk(["restore", "auth-expiry", "--actor", "you"])).toMatchObject({
    code: 1,
    err: "werk restore: refused: #auth-expiry is removed with #auth; restore #auth first\n",
  });
  expect(lines(project)).toHaveLength(count);
  expect((await ok(project, ["removed"])).out).toBe(
    "auth-mail: removed\nauth: removed\n  and auth-expiry  The link expires after ten minutes\n",
  );
  await ok(project, ["restore", "auth", "--actor", "you"]);
  expect((await project.werk(["show", "auth-mail"])).code).toBe(1);
  expect((await ok(project, ["show", "auth"])).out).toContain("auth-expiry");
});
