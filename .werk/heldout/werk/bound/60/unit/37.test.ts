import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { FAKE_DIR } from "../../src/test-env/env.ts";
import { edit, judgeRolesT, makeEnv, type Env, type Reply } from "./35-37-support.ts";

let t: Env;
beforeEach(() => {
  t = makeEnv();
});
afterEach(() => t.dispose());

const verdict = (text: string): Reply => [
  { event: { type: "result", subtype: "success", result: text } },
];
const toolCall = {
  event: {
    type: "assistant",
    message: {
      content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "make" } }],
    },
  },
};
const init = { event: { type: "system", subtype: "init" } };

test("37.1 a silent builder is cancelled, the next brief says so, and the pass counts", async () => {
  t.project.install({
    roles: { ...judgeRolesT(), builder: { replies: [[init, { pause: 20_000 }], [edit("ok.txt", "x")]] } },
  });
  await t.seed();
  const r = await t.build("--silence-ms", "150", "--progress-ms", "10000");
  expect(r.stdout).toContain("merging after 2 passes");
  expect(t.transcriptOf(0)).toContain('"act":"silent"');
  expect(t.transcriptOf(0)).toContain("no event for");
  expect(t.messages()[1]?.text).toContain("silent");
  expect(t.launches("builder")).toHaveLength(2);
  const passes = t.ticket()?.passes ?? [];
  expect(passes.map((p) => p.result)).toEqual(["red", "green"]);
  expect(t.ticket()?.retries).toBe(1);
});

test("37.2 a slow start is not silence", async () => {
  t.project.install({
    roles: { ...judgeRolesT(), builder: { replies: [[{ pause: 900 }, edit("ok.txt", "x")]] } },
  });
  await t.seed();
  const r = await t.build("--silence-ms", "150", "--progress-ms", "10000");
  expect(r.stdout).toContain("merging after 1 pass");
  expect(t.transcriptOf(0)).not.toContain('"act":"silent"');
  expect(t.launches("builder")).toHaveLength(1);
});

test("37.3 the classifier decides asks, and no verdict means deny", async () => {
  t.project.install({
    roles: {
      ...judgeRolesT(),
      builder: {
        replies: [
          [{ ask: { id: "a1", tool: "Bash", input: { command: "make check" } } }],
          [
            { ask: { id: "a2", tool: "Bash", input: { command: "ls" } } },
            edit("ok.txt", "x"),
          ],
        ],
      },
      classifier: {
        replies: [
          verdict('{"verdict":"allow","comment":"it runs the check"}'),
          verdict("hard to say"),
        ],
      },
    },
  });
  await t.seed();
  await t.build("--silence-ms", "5000", "--progress-ms", "10000");
  const log = t.transcriptOf(0);
  expect(log).toContain("allowed Bash make check: it runs the check");
  expect(log).toContain('"content":"allowed"');
  const log2 = t.transcriptOf(1);
  expect(log2).toContain("denied Bash ls: the classifier gave no verdict");
  expect(log2).toContain("The overseer denied this call");
  // The builder continued without the denied call.
  expect(t.ticket()?.column).toBe("merging");
});

test("37.4 a looping verdict cancels the pass, and its reason is in the next brief", async () => {
  t.project.install({
    roles: {
      ...judgeRolesT(),
      builder: { replies: [[toolCall, { pause: 20_000 }], [edit("ok.txt", "x")]] },
      classifier: {
        replies: [verdict('{"verdict":"looping","reason":"make fails the same way each time"}')],
      },
    },
  });
  await t.seed();
  const r = await t.build("--silence-ms", "5000", "--progress-ms", "300");
  expect(r.stdout).toContain("merging after 2 passes");
  const log = t.transcriptOf(0);
  expect(log).toContain('"act":"looping"');
  expect(log).toContain("make fails the same way each time");
  expect(t.messages()[1]?.text).toContain("make fails the same way each time");
});

test("37.4b without a new tool call the classifier is not asked again", async () => {
  t.project.install({
    roles: {
      ...judgeRolesT(),
      builder: { replies: [[toolCall, { pause: 2500 }, edit("ok.txt", "x")]] },
      classifier: {
        replies: [verdict('{"verdict":"not looping","reason":"progressing"}')],
      },
    },
  });
  await t.seed();
  const r = await t.build("--silence-ms", "10000", "--flat-ms", "10000", "--progress-ms", "300");
  expect(r.stdout).toContain("merging after 1 pass");
  expect(t.launches("classifier")).toHaveLength(1);
});

test("37.5 a failed process probe cancels nothing", async () => {
  const bin = mkdtempSync(join(tmpdir(), "werk-badps-"));
  writeFileSync(join(bin, "ps"), "#!/bin/sh\necho 'ps: cannot read the process table' >&2\nexit 1\n");
  chmodSync(join(bin, "ps"), 0o755);
  t.project.install({
    roles: {
      ...judgeRolesT(),
      builder: { replies: [[toolCall, { pause: 6000 }, edit("ok.txt", "x")]] },
      classifier: { replies: [] },
    },
  });
  await t.seed();
  const PATH = [FAKE_DIR, bin, process.env.PATH ?? ""].join(delimiter);
  const r = await t.project.run(
    ["bun", join(import.meta.dir, "../../src/cli.ts"), "build", "r/01", "--poll-ms", "100",
      "--silence-ms", "300", "--flat-ms", "400", "--progress-ms", "100000", "--agent-ms", "3000"],
    { PATH },
  );
  const log = t.transcriptOf(0);
  expect(log).toContain('"act":"probe-failed"');
  expect(log).not.toContain('"act":"frozen"');
  expect(log).not.toContain('"act":"silent"');
  // The pass ended only at the wall-clock limit.
  expect(r.stdout).toContain("ready after");
  expect(t.pipelinePasses().passes[0]?.reason).toContain("time limit");
});
