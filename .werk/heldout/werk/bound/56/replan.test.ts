import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readBoard } from "../src/board/log-store.ts";
import { decided } from "../src/map/mark-fixtures.ts";
import { ticket } from "../src/tickets/fixtures.ts";
import { cli, createProject, type Project, seedBoard, seedLog, boardPath, SLOW, YOU } from "./support.ts";

let project: Project;
let werk: ReturnType<typeof cli>;
beforeEach(() => {
  project = createProject();
  werk = cli(project);
});
afterEach(() => project.dispose());

const board = () => readBoard(boardPath(project));

/** A planned subtree: root with card c1, one spec, and tickets 1 to 3 on the board. */
function planned(statuses: ("ready" | "building" | "done")[] = ["ready", "ready", "ready"]) {
  seedLog(project, decided("root"), decided("c1", { parent: "root", title: "Card one", body: "first words" }), decided("c2", { parent: "root", title: "Card two" }));
  const dir = join(project.dir, ".werk", "tickets", "root");
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(project.dir, ".werk", "specs", "root"), { recursive: true });
  writeFileSync(join(project.dir, ".werk", "specs", "root", "spec.md"), "## User stories\n\n1. a\n2. b\n3. c\n");
  const events: unknown[] = [];
  statuses.forEach((st, i) => {
    const n = String(i + 1).padStart(2, "0");
    writeFileSync(join(dir, `${n}.md`), ticket({ cites: i === 1 ? "c2" : "c1", stories: String(i + 1) }));
    events.push({ type: "ticket.planned", id: `root/${n}`, title: `Ticket ${n}` });
    if (st === "building" || st === "done") events.push({ type: "ticket.moved", id: `root/${n}`, to: "building" });
    if (st === "done") events.push({ type: "ticket.moved", id: `root/${n}`, to: "merging", actor: "loop" }, { type: "ticket.merge", id: `root/${n}` });
  });
  seedBoard(project, ...events);
}

test("29.1 a second plan of the same subtree extends the spec and continues the ticket numbers", async () => {
  planned(["building", "done", "ready"]);
  project.install({ roles: { "spec-writer": { replies: [[{ event: { type: "result", subtype: "success", is_error: false, result: "" } }]] }, "ticket-writer": { replies: [[{ event: { type: "result", subtype: "success", is_error: false, result: "" } }]] } } });
  await werk("add", "c3", "--title", "Card three", "--parent", "root");
  await werk("accept", "c3", ...YOU);
  const r = await werk("plan", "root");
  expect(r.stderr).not.toMatch(/Archive them before a new plan/);
  const b = board();
  expect([...b.tickets.keys()]).toContain("root/04");
  expect(b.tickets.get("root/01")?.column).toBe("building");
  expect(b.tickets.get("root/02")?.column).toBe("done");
}, SLOW);

test("29.2 an open ticket the new spec no longer needs is archived and can be restored", async () => {
  planned();
  await werk("remove", "c2", ...YOU);
  await werk("plan", "root");
  expect(board().tickets.get("root/02")?.archived).toBe(true);
  expect((await werk("ticket", "restore", "2", ...YOU)).code).toBe(0);
  expect(board().tickets.get("root/02")?.archived).toBe(false);
}, SLOW);

test("29.3 retitling a cited card blocks the ready ticket that cites it, and a re-plan clears the block", async () => {
  planned();
  await werk("propose", "c1", "--title", "A new title");
  await werk("accept", "c1", ...YOU);
  const t = board().tickets.get("root/01");
  expect(t?.column).toBe("blocked");
  expect(t?.reason).toMatch(/c1/);
  expect(t?.reason).toMatch(/title/);
}, SLOW);

test("29.4 a note blocks nothing, a changed body blocks the ready ticket but never a building one", async () => {
  planned(["ready", "building", "ready"]);
  writeFileSync(join(project.dir, ".werk", "tickets", "root", "02.md"), ticket({ cites: "c1", stories: "2" }));
  await werk("say", "c1", "a note");
  expect(board().tickets.get("root/01")?.column).toBe("ready");
  await werk("propose", "c1", "--ops", JSON.stringify([{ tag: "new", new: "second words" }]));
  await werk("accept", "c1", ...YOU);
  const b = board();
  expect(b.tickets.get("root/01")?.column).toBe("blocked");
  expect(b.tickets.get("root/01")?.reason).toMatch(/c1.*body/i);
  expect(b.tickets.get("root/02")?.column).toBe("building");
  expect(b.tickets.get("root/02")?.reason).toBe("");
}, SLOW);

test("29.5 a card added under a planned subtree reports a failed cards-cited check without blocking tickets", async () => {
  planned();
  const added = await werk("add", "c9", "--title", "Uncited", "--parent", "root");
  expect(`${added.stdout}${added.stderr}`).toMatch(/cards-cited/);
  expect(`${added.stdout}${added.stderr}`).toContain("c9");
  for (const id of ["root/01", "root/02", "root/03"]) expect(board().tickets.get(id)?.column).toBe("ready");
  expect(readFileSync(boardPath(project), "utf8")).not.toContain("blocked");
}, SLOW);
