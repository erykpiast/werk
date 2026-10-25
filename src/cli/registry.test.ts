import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VERB_MODULE_NAMES } from "../own/verb-names.ts";
import { loadVerbs } from "./load.ts";
import { main } from "./main.ts";
import { createRegistry, registry } from "./registry.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    cwd: "/",
    env: {},
    out: (t: string) => void out.push(t),
    err: (t: string) => void err.push(t),
    lines: { out, err },
  };
}

test("registering a name twice keeps the later verb", () => {
  const r = createRegistry();
  r.register({ name: "x", summary: "one", run: () => 0 });
  r.register({ name: "x", summary: "two", run: () => 0 });
  expect(r.list().map((v) => v.summary)).toEqual(["two"]);
});

test("a verb module in the file list registers itself, with no edit to a shared list", async () => {
  const dir = mkdtempSync(join(tmpdir(), "werk-verbs-"));
  dirs.push(dir);
  const file = join(dir, "zzz-extra.ts");
  writeFileSync(
    file,
    `import { registerVerb } from ${JSON.stringify(join(import.meta.dir, "registry.ts"))};
registerVerb({ name: "zzz-extra", summary: "A verb added by its own module", run: () => 7 });`,
  );
  const modules = [{ name: "zzz-extra.ts", load: () => import(file) }];
  expect(await loadVerbs(modules)).toEqual(["zzz-extra.ts"]);
  expect(await main(["zzz-extra"], registry, io())).toBe(7);
});

test("the bundled list names every verb module and no test", () => {
  const onDisk = readdirSync(join(import.meta.dir, "..", "verbs"))
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .sort();
  expect([...VERB_MODULE_NAMES]).toEqual(onDisk);
});

test("the help output lists every registered verb", async () => {
  await loadVerbs();
  const channel = io();
  expect(await main([], registry, channel)).toBe(0);
  const text = channel.lines.out.join("\n");
  for (const verb of registry.list()) expect(text).toContain(verb.name);
  expect(text).toContain("add");
  expect(text).toContain("show");
});

test("an unknown verb exits 2 and prints the verb list on the error channel", async () => {
  await loadVerbs();
  const channel = io();
  expect(await main(["nope"], registry, channel)).toBe(2);
  expect(channel.lines.err.join("\n")).toContain('unknown verb "nope"');
  expect(channel.lines.err.join("\n")).toContain("show");
});

test("with no help verb registered, a bare call exits 0 and an unknown verb exits 2", async () => {
  const r = createRegistry();
  expect(await main(["--help"], r, io())).toBe(0);
  expect(await main(["x"], r, io())).toBe(2);
});
