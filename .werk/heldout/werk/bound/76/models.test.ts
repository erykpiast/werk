import { expect, test } from "bun:test";
import { modelFlags } from "../src/agent/role-model.ts";
import { edit, ok, planProject, serve, SPEC, ticketText, type Project } from "./h.ts";

const flag = (args: string[], name: string) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const GOOD = {
  "01.md": ticketText("Pay", "checkout, checkout-cart", "", "1"),
  "02.md": ticketText("Retry", "checkout-pay", "1", "2"),
};
function writers(p: Project) {
  p.script({
    roles: {
      "spec-writer": { replies: [[edit(".werk/specs/checkout.md", SPEC), edit(".werk/specs/checkout.spec-answers.json", "[]")]] },
      "ticket-writer": {
        replies: [[...Object.entries(GOOD).map(([f, t]) => edit(`.werk/tickets/checkout/${f}`, t)), edit(".werk/specs/checkout.ticket-answers.json", "[]")]],
      },
      chat: {
        sessions: ["sess-A"],
        replies: [
          [{ event: { type: "system", subtype: "init", session_id: "sess-A" } }, { event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "one" }] } } }],
          [{ event: { type: "assistant", message: { id: "m2", content: [{ type: "text", text: "two" }] } } }],
        ],
      },
    },
  });
}

test("76.1 planner agents run on Opus without an advisor", async () => {
  const p = await planProject();
  writers(p);
  const r = await p.werk(["plan", "checkout"]);
  expect(r.code).toBe(0);
  const ls = p.launches();
  expect(ls.map((l) => l.role)).toEqual(["spec-writer", "ticket-writer"]);
  for (const l of ls) {
    expect(flag(l.args, "--model")).toBe("claude-opus-5-5");
    expect(l.args).not.toContain("--advisor");
    expect(["opus", "sonnet"]).not.toContain(flag(l.args, "--model"));
  }
});

async function until<T>(f: () => T | undefined, ms = 8000): Promise<T | undefined> {
  const end = Date.now() + ms;
  for (;;) {
    const v = f();
    if (v !== undefined || Date.now() > end) return v;
    await Bun.sleep(100);
  }
}

test("76.2 the chat agent keeps the model picked in the chat header", async () => {
  const p = await planProject();
  writers(p);
  expect((await p.werk(["plan", "checkout"])).code).toBe(0);
  const s = await serve(p);
  const OPUS = "claude-opus-5-5";
  const SONNET = "claude-sonnet-5-5[1m]";
  expect((await s.post("/api/model", { model: OPUS, advisor: null })).status).toBe(200);
  expect((await s.post("/api/chat", { text: "hello", turn: "t1", card: "root" })).status).toBe(200);
  const chat1 = await until(() => p.launches().filter((l) => l.role === "chat")[0]);
  expect(chat1).toBeDefined();
  expect(flag(chat1?.args ?? [], "--model")).toBe(OPUS);
  expect(chat1?.args).not.toContain("--advisor");
  expect((await s.post("/api/model", { model: SONNET, advisor: OPUS })).status).toBe(200);
  expect((await s.post("/api/chat", { text: "again", turn: "t2", card: "root" })).status).toBe(200);
  const chat2 = await until(() => p.launches().filter((l) => l.role === "chat")[1]);
  expect(chat2).toBeDefined();
  expect(flag(chat2?.args ?? [], "--model")).toBe(SONNET);
  expect(flag(chat2?.args ?? [], "--advisor")).toBe(OPUS);
  // same session: the second launch resumes
  expect(flag(chat2?.args ?? [], "--resume")).toBe("sess-A");
  void ok;
});

test("76.4 a role the table does not know is reported as an error", async () => {
  let threw = false;
  let flags: string[] = [];
  try {
    flags = modelFlags("mystery-role");
  } catch (e) {
    threw = String(e).includes("mystery-role");
  }
  expect(threw).toBe(true);
  expect(flags).toEqual([]);
});
