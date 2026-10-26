import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { judgeRoles } from "../src/build/judge-fixtures.ts";
import type { Reply } from "../src/fake-agent/script.ts";
import { createProject, type Project } from "./h.ts";
import { ctx, edit } from "./hb.ts";

let p: Project;
let c: ReturnType<typeof ctx>;
beforeEach(() => {
  p = createProject();
  c = ctx(p);
});
afterEach(() => p.dispose());

const verdict = (text: string): Reply => [{ event: { type: "result", subtype: "success", result: text } }];
const toolCall = {
  event: {
    type: "assistant",
    message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "make" } }] },
  },
};
const script = (builder: Reply[], classifier?: Reply[]) => ({
  roles: {
    ...judgeRoles(),
    builder: { replies: builder },
    ...(classifier ? { classifier: { replies: classifier } } : {}),
  },
});

test("37.1 a silent builder is cancelled and the next pass is told why", async () => {
  p.install(script([[{ event: { type: "system", subtype: "init" } }, { pause: 20_000 }], [edit("ok.txt", "done")]]));
  await c.seed();
  const r = await c.build("--silence-ms", "300", "--progress-ms", "10000");
  expect(r.stdout).toContain("merging after 2 passes");
  expect(c.transcriptOf(0)).toContain('"act":"silent"');
  expect(c.transcriptOf(0)).toMatch(/cancelled|silent/);
  expect(c.messages()[1]?.text).toContain("silent");
  expect(c.ticket()?.passes[0]?.result).toBe("red");
  expect(c.ticket()?.retries).toBe(1);
});

test("37.2 a slow start is not treated as silence", async () => {
  p.install(script([[{ pause: 900 }, edit("ok.txt", "done")]]));
  await c.seed();
  const r = await c.build("--silence-ms", "300", "--progress-ms", "10000");
  expect(r.stdout).toContain("merging after 1 pass");
  expect(c.transcriptOf(0)).not.toContain('"act":"silent"');
});

test("37.3 a permission ask is decided by the classifier, and no verdict means deny", async () => {
  p.install(
    script(
      [
        [
          { ask: { id: "a1", tool: "Bash", input: { command: "ls" } } },
          { ask: { id: "a2", tool: "Bash", input: { command: "pwd" } } },
          edit("ok.txt", "done"),
        ],
      ],
      [verdict('{"verdict":"allow","comment":"a plain read"}'), verdict("hard to say")],
    ),
  );
  await c.seed();
  const r = await c.build("--silence-ms", "5000", "--progress-ms", "10000");
  expect(r.stdout).toContain("merging after 1 pass");
  const log = c.transcriptOf(0);
  expect(log).toMatch(/allowed Bash [^"]*: a plain read/);
  expect(log).toMatch(/denied Bash [^"]*: the classifier gave no verdict/);
  expect(log).toContain("The overseer denied this call");
});

test("37.4 a looping verdict cancels the pass and the reason reaches the next brief", async () => {
  p.install(
    script(
      [[toolCall, { pause: 20_000 }], [edit("ok.txt", "done")]],
      [verdict('{"verdict":"looping","reason":"make fails the same way"}')],
    ),
  );
  await c.seed();
  const r = await c.build("--silence-ms", "5000", "--progress-ms", "300");
  expect(r.stdout).toContain("merging after 2 passes");
  expect(c.transcriptOf(0)).toContain('"act":"looping"');
  expect(c.transcriptOf(0)).toContain("make fails the same way");
  expect(c.messages()[1]?.text).toContain("make fails the same way");
});

test("37.4b with no new tool call since the last verdict the classifier is not asked", async () => {
  p.install(
    script(
      [[toolCall, { pause: 2500 }, edit("ok.txt", "done")]],
      Array.from({ length: 12 }, () => verdict('{"verdict":"not looping","reason":"fine"}')),
    ),
  );
  await c.seed();
  const r = await c.build("--silence-ms", "9000", "--flat-ms", "9000", "--progress-ms", "300");
  expect(r.stdout).toContain("merging after 1 pass");
  expect(c.launched("classifier").length).toBe(1);
});

test("37.5 a failed process probe cancels nothing", async () => {
  const shim = join(p.dir, "..", "shim");
  mkdirSync(shim);
  writeFileSync(join(shim, "ps"), "#!/bin/sh\nexit 1\n");
  chmodSync(join(shim, "ps"), 0o755);
  p.install(script([[toolCall, { pause: 1500 }, edit("ok.txt", "done")]]));
  await c.seed();
  const r = await p.run(c.buildArgs("--silence-ms", "300", "--flat-ms", "400", "--progress-ms", "20000"), {
    PATH: `${shim}:${process.env.PATH}`,
  });
  expect(r.stdout).toContain("merging after 1 pass");
  const log = c.transcriptOf(0);
  expect(log).toContain("probe-failed");
  expect(log).not.toContain('"act":"frozen"');
  expect(log).not.toContain('"act":"silent"');
});
