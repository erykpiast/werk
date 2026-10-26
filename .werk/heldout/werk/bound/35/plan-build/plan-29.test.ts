import { afterEach, beforeEach, expect, setDefaultTimeout, test } from "bun:test";

setDefaultTimeout(60000);
import { readFileSync } from "node:fs";
import { decided } from "../../src/map/mark-fixtures.ts";
import {
  edit,
  RESULT,
  SPEC_ANSWERS,
  SPEC_ONE,
  SPEC_TWO,
  spec,
  t,
  tickets,
  until,
  Ws,
} from "./helpers.ts";

let w: Ws;
beforeEach(() => {
  w = new Ws();
});
afterEach(() => w.dispose());

const kid = () => [
  ...decided("app"),
  ...decided("kid"),
  { type: "edge.added", from: "kid", to: "app", link: "refines" },
];

async function planOnce(map: unknown[], firstTickets: [string, string][], second: any) {
  w.seed(map);
  w.project.install({
    roles: {
      "spec-writer": { replies: [spec(SPEC_ONE), second.spec] },
      "ticket-writer": {
        replies: [tickets(...firstTickets), second.tickets],
      },
    },
  });
  const r = await w.werk("plan", "app");
  expect(r.stderr).toBe("");
  expect(r.code).toBe(0);
}

test("29.1 a second plan extends the spec and continues the ticket numbers", async () => {
  await planOnce(
    decided("app"),
    [
      ["01-a.md", t(1)],
      ["02-b.md", t(2)],
      ["03-c.md", t(3)],
    ],
    {
      spec: spec(SPEC_TWO),
      tickets: [
        edit("tickets/app/03-c.md", t(3, "app", "1").replace("Ticket 3", "Ticket 3 rewritten")),
        edit("tickets/app/04-d.md", t(4, "late", "2")),
        edit("specs/app/ticket-answers.json", "[]"),
        RESULT,
      ],
    },
  );
  expect([...w.board().tickets.values()].map((x) => x.column)).toEqual(["ready", "ready", "ready"]);
  const one = w.file("tickets/app/01-a.md");
  const two = w.file("tickets/app/02-b.md");
  w.put(
    { type: "ticket.moved", id: "app/01", to: "building", actor: "you" },
    { type: "ticket.moved", id: "app/02", to: "building", actor: "you" },
    { type: "ticket.moved", id: "app/02", to: "merging", actor: "loop" },
    { type: "ticket.merge", id: "app/02" },
  );
  w.log(decided("late"), {
    type: "edge.added",
    from: "late",
    to: "app",
    link: "refines",
  });
  const again = await w.werk("plan", "app");
  expect(again.stderr).toBe("");
  expect(again.code).toBe(0);
  const b = w.board();
  expect(b.plans.size).toBe(1);
  expect(w.file("specs/app/spec.md")).toContain("late card");
  expect(b.tickets.get("app/03")?.title).toBe("Ticket 3 rewritten");
  expect(b.tickets.get("app/04")).toMatchObject({ title: "Ticket 4", column: "ready" });
  expect([...b.tickets.keys()].sort()).toEqual(["app/01", "app/02", "app/03", "app/04"]);
  expect(b.tickets.get("app/01")).toMatchObject({ column: "building", title: "Ticket 1" });
  expect(b.tickets.get("app/02")).toMatchObject({ column: "done", title: "Ticket 2" });
  expect(w.file("tickets/app/01-a.md")).toBe(one);
  expect(w.file("tickets/app/02-b.md")).toBe(two);
});

test("29.2 a ticket the new spec no longer needs is archived and can be restored", async () => {
  await planOnce(
    kid(),
    [
      ["01-a.md", t(1, "app")],
      ["02-b.md", t(2, "kid")],
    ].map(([a, b]) => [a, b]) as [string, string][],
    {
      spec: spec(SPEC_ONE),
      tickets: [
        edit(
          "specs/app/ticket-drops.json",
          JSON.stringify([{ ticket: 2, why: "the current spec no longer needs it" }]),
        ),
        edit("specs/app/ticket-answers.json", "[]"),
        RESULT,
      ],
    },
  );
  // "app" decided, kid decided under it
  expect(w.board().tickets.get("app/02")?.column).toBe("ready");
  const rm = await w.werk("remove", "kid", "--actor", "you");
  expect(rm.code).toBe(0);
  const again = await w.werk("plan", "app");
  expect(again.stderr).toBe("");
  expect(again.code).toBe(0);
  const gone = w.board().tickets.get("app/02");
  expect(gone?.archived).toBe(true);
  expect(gone?.archive?.reason).toContain("no longer needs");
  const restore = await w.werk("ticket", "restore", "02", "--actor", "you");
  expect(restore.code).toBe(0);
  const back = w.board().tickets.get("app/02");
  expect(back?.archived).toBe(false);
  expect(back?.id).toBe("app/02");
});

async function server() {
  w.project.start(["bun", `${import.meta.dir}/../../src/cli.ts`, "serve", "--port", "0"]);
  await until(() => {
    const lock = JSON.parse(readFileSync(`${w.project.dir}/.werk/serve.lock`, "utf8"));
    return lock.port > 0 ? lock.port : undefined;
  });
}

const rewrite = {
  spec: spec(SPEC_ONE),
  tickets: [
    edit("tickets/app/01-a.md", t(1)),
    edit("tickets/app/02-b.md", t(2)),
    edit("specs/app/ticket-answers.json", "[]"),
    RESULT,
  ],
};

test("29.3 retitling a cited card blocks the ready ticket that cites it, and a re-plan clears the block", async () => {
  await planOnce(decided("app"), [["01-a.md", t(1)]], {
    spec: spec(SPEC_ONE),
    tickets: [edit("tickets/app/01-a.md", t(1).replace("A person", "A person (new title)")), edit("specs/app/ticket-answers.json", "[]"), RESULT],
  });
  expect(w.board().tickets.get("app/01")?.column).toBe("ready");
  await server();
  expect((await w.werk("propose", "app", "--title", "Brand new title")).code).toBe(0);
  expect((await w.werk("accept", "app", "--actor", "you")).code).toBe(0);
  const blocked = await until(() => {
    const x = w.board().tickets.get("app/01");
    return x?.column === "blocked" ? x : undefined;
  });
  expect(blocked.reason).toContain("#app");
  expect(blocked.reason).toContain("title changed");
  // the server keeps a lock on the project; the plan runs beside it
  const again = await w.werk("plan", "app");
  expect(again.stderr).toBe("");
  const x = w.board().tickets.get("app/01");
  expect(x?.column).toBe("ready");
  expect(x?.marks).toEqual([]);
});

test("29.4 a note blocks nothing, a body change blocks the ready ticket, never the building one", async () => {
  await planOnce(decided("app"), [["01-a.md", t(1)], ["02-b.md", t(2)]], rewrite);
  w.put({ type: "ticket.moved", id: "app/02", to: "building", actor: "you" });
  await server();
  expect((await w.werk("say", "app", "a thought")).code).toBe(0);
  await Bun.sleep(1500); // negative check: give the watcher time to act
  for (const id of ["app/01", "app/02"]) {
    const x = w.board().tickets.get(id);
    expect(x?.marks).toEqual([]);
    expect(x?.reason ?? "").toBe("");
  }
  expect(w.board().tickets.get("app/01")?.column).toBe("ready");
  const p = await w.werk("propose", "app", "--ops", JSON.stringify([{ tag: "new", new: "A new block of body." }]));
  expect(p.stderr).toBe("");
  expect((await w.werk("accept", "app", "--actor", "you")).code).toBe(0);
  const blocked = await until(() => {
    const x = w.board().tickets.get("app/01");
    return x?.column === "blocked" ? x : undefined;
  });
  expect(blocked.reason).toContain("#app");
  expect(blocked.reason).toContain("body changed");
  const building = w.board().tickets.get("app/02");
  expect(building?.column).toBe("building");
  expect(building?.reason ?? "").toBe("");
});

test("29.5 a card added under a planned subtree reports a failed cards-cited check without blocking tickets", async () => {
  await planOnce(decided("app"), [["01-a.md", t(1)], ["02-b.md", t(2)]], rewrite);
  await server();
  expect((await w.werk("add", "late", "--title", "Late card", "--parent", "app")).code).toBe(0);
  expect((await w.werk("accept", "late", "--actor", "you")).code).toBe(0);
  // The cards-cited check reads decided cards, so the new card is decided through the verbs.
  expect((await w.werk("edit", "late", "--who", "me")).code).toBe(0);
  expect((await w.werk("edit", "late", "--no-basis", "test")).code).toBe(0);
  expect((await w.werk("kill", "late", "--revisit")).code).toBe(0);
  const dec = await w.werk("status", "late", "decided");
  expect(dec.stderr).toBe("");
  const check = await until(() => {
    const p = w.board().plans.get("app");
    return p && p.uncited.length > 0 ? p : undefined;
  }).catch(() => undefined);
  expect(check?.uncited).toContain("late");
  for (const id of ["app/01", "app/02"]) {
    expect(w.board().tickets.get(id)?.column).toBe("ready");
  }
});
