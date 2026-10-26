import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, symlinkSync } from "node:fs";
import { delimiter, join } from "node:path";
import { FAKE_DIR } from "../src/test-env/env.ts";
import type { Reply } from "../src/fake-agent/script.ts";
import { CLI } from "./cli.ts";
import { edit, judgeRoles, kit } from "./build-kit.ts";

let k: ReturnType<typeof kit>;
beforeEach(() => {
  k = kit();
});
afterEach(() => k.project.dispose());

const verdict = (text: string): Reply => [{ event: { type: "result", subtype: "success", result: text } }];
const toolCall = (id = "t1", cmd = "make") => ({
  event: { type: "assistant", message: { content: [{ type: "tool_use", id, name: "Bash", input: { command: cmd } }] } },
});
const init = { event: { type: "system", subtype: "init" } };
const quiet = ["--progress-ms", "100000"];

test("37.1 a silent builder is cancelled and the next pass is told why", async () => {
  k.project.install({ roles: { ...judgeRoles(), builder: { replies: [[init, { pause: 20_000 }], [edit("ok.txt", "done")]] } } });
  await k.seed();
  const r = await k.build("--silence-ms", "50", ...quiet);
  expect(r.stdout).toContain("merging after 2 passes");
  expect(k.transcriptOf(0)).toContain('"act":"silent"');
  expect(k.transcriptOf(0)).toMatch(/silent|no event/);
  expect(k.messages()[1]?.text).toContain("silent");
  expect(k.ticket()?.retries).toBe(1);
  expect(k.ticket()?.passes.map((p) => p.result)).toEqual(["red", "green"]);
});

test("37.2 a slow start is not treated as silence", async () => {
  k.project.install({ roles: { ...judgeRoles(), builder: { replies: [[{ pause: 900 }, edit("ok.txt", "done")]] } } });
  await k.seed();
  const r = await k.build("--silence-ms", "400", ...quiet);
  expect(r.stdout).toContain("merging after 1 pass");
  expect(k.transcriptOf(0)).not.toContain('"act":"silent"');
});

test("37.3 a permission ask is decided by the classifier, and no verdict means deny", async () => {
  k.project.install({
    roles: {
      ...judgeRoles(),
      builder: {
        replies: [[{ ask: { id: "a1", tool: "Bash", input: { command: "ls" } } }, { pause: 700 }, { ask: { id: "a2", tool: "Bash", input: { command: "pwd" } } }, edit("ok.txt", "done")]],
      },
      classifier: { replies: [verdict('{"verdict":"allow","comment":"listing is harmless"}'), verdict("hard to say")] },
    },
  });
  await k.seed();
  await k.build("--silence-ms", "5000", ...quiet);
  const log = k.transcriptOf(0);
  expect(log).toContain("allowed Bash ls: listing is harmless");
  expect(log).toMatch(/"content":"allowed"/);
  expect(log).toContain("denied Bash pwd: the classifier gave no verdict");
  expect(log).toContain("The overseer denied this call");
  expect(k.launched("classifier")).toHaveLength(2);
  expect(k.ticket()?.column).toBe("merging");
});

test("37.4 a looping verdict cancels the pass and the reason reaches the next brief", async () => {
  k.project.install({
    roles: {
      ...judgeRoles(),
      builder: { replies: [[toolCall("t1", "make test"), toolCall("t2", "make test"), { pause: 20_000 }], [edit("ok.txt", "done")]] },
      classifier: { replies: [verdict('{"verdict":"looping","reason":"make test fails the same way"}')] },
    },
  });
  await k.seed();
  const r = await k.build("--silence-ms", "5000", "--progress-ms", "300");
  expect(r.stdout).toContain("merging after 2 passes");
  expect(k.transcriptOf(0)).toContain('"act":"looping"');
  expect(k.transcriptOf(0)).toContain("make test fails the same way");
  expect(k.messages()[1]?.text).toContain("make test fails the same way");
});

test("37.4b the classifier is not asked again when no new tool call came since the last verdict", async () => {
  k.project.install({
    roles: {
      ...judgeRoles(),
      builder: { replies: [[toolCall("t1"), { event: { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } } }, { pause: 2500 }, edit("ok.txt", "done")]] },
      classifier: { replies: [verdict('{"verdict":"not looping","reason":"it moves"}')] },
    },
  });
  await k.seed();
  const r = await k.build("--silence-ms", "10000", "--progress-ms", "200");
  expect(r.stdout).toContain("merging after 1 pass");
  expect(k.launched("classifier")).toHaveLength(1);
});

test("37.5 a failed process probe cancels nothing", async () => {
  // A path with no ps: the probe cannot read the process table.
  const bin = join(k.project.dir, "..", "nops");
  mkdirSync(bin, { recursive: true });
  for (const tool of ["bun", "git", "make", "sh", "env", "bash", "test", "cat", "rm", "mkdir", "ls", "dirname", "basename", "uname", "tr", "sed", "grep", "head", "sleep"]) {
    const found = Bun.which(tool, { PATH: "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin" }) ?? Bun.which(tool);
    if (found) {
      try {
        symlinkSync(found, join(bin, tool));
      } catch {}
    }
  }
  const bunPath = Bun.which("bun");
  if (bunPath) try { symlinkSync(bunPath, join(bin, "bun")); } catch {}
  k.project.install({ roles: { ...judgeRoles(), builder: { replies: [[toolCall("t1"), { pause: 2500 }, { event: { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } } }, edit("ok.txt", "done")]] } } });
  await k.seed();
  const r = await k.project.run(["bun", CLI, "build", "r/01", "--poll-ms", "100", "--silence-ms", "300", "--flat-ms", "300", ...quiet], { PATH: [FAKE_DIR, bin].join(delimiter) });
  expect(r.stdout).toContain("merging after 1 pass");
  expect(k.transcriptOf(0)).toContain('"act":"probe-failed"');
  expect(k.transcriptOf(0)).not.toContain('"act":"frozen"');
});
