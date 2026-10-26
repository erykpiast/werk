import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { useProject } from "../src/test-env/project.ts";
import { all, lines, werk } from "./helpers.ts";

const project = useProject();

const ev = (e: Record<string, unknown>) => `${JSON.stringify(e)}\n`;

/** Writes the board log: tickets of the plan "app", each in the column the test names. */
function board(p: ReturnType<typeof project>, tickets: Record<string, "done" | "building">) {
  let text = "";
  for (const [number, column] of Object.entries(tickets)) {
    const id = `app/${number}`;
    text += ev({ type: "ticket.planned", id, title: `Ticket ${number}` });
    text += ev({ type: "ticket.moved", id, to: "building", actor: "loop" });
    if (column === "done") {
      text += ev({ type: "ticket.moved", id, to: "merging", actor: "loop" });
      text += ev({ type: "ticket.merge", id });
    }
  }
  writeFileSync(join(p.dir, ".werk", "board.jsonl"), text);
}

const list = async (p: ReturnType<typeof project>, id: string) =>
  lines((await werk(p, "followup", id, "--list")).stdout);

test("43.1 a build miss on a done ticket is recorded and listed", async () => {
  const p = project();
  board(p, { "01": "done" });
  const r = await werk(p, "followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the link expires after 1 minute, the card says 15", "--catchable", "yes");
  expect(r.code).toBe(0);
  expect(all(r)).toMatch(/recorded/);
  const out = await list(p, "app/01");
  expect(out.length).toBe(1);
  expect(out[0]).toMatch(/^1\./);
  expect(out[0]).toContain("build");
  expect(out[0]).toMatch(/after[- ]merge/);
  expect(out[0]).toContain("the link expires after 1 minute, the card says 15");
  expect(out[0]).toMatch(/catch\w*:? yes/);
});

test("43.2 a plan miss is recorded without a catchable answer", async () => {
  const p = project();
  board(p, { "01": "done" });
  const r = await werk(p, "followup", "app/01", "--class", "plan", "--found", "review", "--why", "no card said how long the link lasts");
  expect(r.code).toBe(0);
  expect(all(r)).toMatch(/recorded/);
  const out = await list(p, "app/01");
  expect(out.length).toBe(1);
  expect(out[0]).toContain("plan");
  expect(out[0]).toContain("review");
  expect(out[0]).toContain("no card said how long the link lasts");
  expect(out[0]).not.toMatch(/catch/);
});

test("43.3 a wrong catchable answer is refused and nothing is recorded", async () => {
  const p = project();
  board(p, { "01": "done" });
  const a = await werk(p, "followup", "app/01", "--class", "build", "--found", "review", "--why", "the button label is wrong");
  expect(a.code).not.toBe(0);
  expect(all(a)).toMatch(/build miss needs .*catchable answer/);
  const b = await werk(p, "followup", "app/01", "--class", "plan", "--found", "review", "--why", "the card was silent", "--catchable", "no");
  expect(b.code).not.toBe(0);
  expect(all(b)).toMatch(/plan miss .*(not take|no|has no) .*catchable answer/);
  expect(await list(p, "app/01")).toEqual([]);
});

test("43.4 a ticket that is not done, or does not exist, is refused", async () => {
  const p = project();
  board(p, { "02": "building" });
  const a = await werk(p, "followup", "app/02", "--class", "build", "--found", "review", "--why", "rename the button", "--catchable", "no");
  expect(a.code).not.toBe(0);
  expect(all(a)).toMatch(/not done/);
  const b = await werk(p, "followup", "app/99", "--class", "plan", "--found", "review", "--why", "missing rule");
  expect(b.code).not.toBe(0);
  expect(all(b)).toMatch(/no ticket|does not exist|not exist/i);
  expect(await list(p, "app/02")).toEqual([]);
});

test("43.5 the last correction of a record is the class in force", async () => {
  const p = project();
  board(p, { "01": "done" });
  const first = await werk(p, "followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the link expires", "--catchable", "yes");
  expect(first.code).toBe(0);
  const c1 = await werk(p, "followup", "app/01", "--class", "plan", "--found", "after-merge", "--why", "the card never said 15 minutes", "--of", "1");
  expect(c1.code).toBe(0);
  let out = await list(p, "app/01");
  expect(out.length).toBe(2);
  expect(out[0]).toMatch(/^1\..*plan/);
  expect(out[0]).toMatch(/in force/);
  expect(out[1]).toMatch(/^2\..*correction of 1/);
  const c2 = await werk(p, "followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the card does say 15 minutes", "--catchable", "yes", "--of", "1");
  expect(c2.code).toBe(0);
  out = await list(p, "app/01");
  expect(out[0]).toMatch(/^1\..*in force.*build/);
});
