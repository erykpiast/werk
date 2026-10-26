import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  buildRelease,
  CHECKOUT,
  emptyFolderWith,
  HERE,
  NO_BUN_PATH,
  PLATFORMS,
} from "./release-helper.ts";

let rel: ReturnType<typeof buildRelease>;
beforeAll(() => {
  rel = buildRelease();
}, 300000);
afterAll(() => rmSync(rel.root, { recursive: true, force: true }));

test("49.1 the release build finishes and writes four executables, each with a matching checksum", () => {
  expect(rel.built.status, rel.built.stderr).toBe(0);
  for (const p of PLATFORMS) {
    const file = join(rel.out, `werk-${p}`);
    expect(existsSync(file)).toBe(true);
    expect(existsSync(`${file}.sha256`)).toBe(true);
    const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
    expect(readFileSync(`${file}.sha256`, "utf8").trim()).toBe(`${digest}  werk-${p}`);
  }
  const names = readdirSync(rel.out).filter((n) => n.startsWith("werk-") && !n.endsWith(".sha256"));
  expect(names.sort()).toEqual(PLATFORMS.map((p) => `werk-${p}`).sort());
});

function run(cmd: string[], cwd: string, env: Record<string, string>) {
  const r = Bun.spawnSync(cmd, { cwd, env });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

test("49.3 the executable's help lists every command that a checkout lists, and a listed command works", () => {
  const { dir, copy } = emptyFolderWith(rel.root, join(rel.out, `werk-${HERE}`));
  const env = { PATH: NO_BUN_PATH, HOME: join(rel.root, "home"), WERK_HOME: join(rel.root, "wh") };
  const exe = run([copy, "help"], dir, env);
  expect(exe.code).toBe(0);
  const checkout = run(["bun", join(CHECKOUT, "src/cli.ts"), "help"], dir, { ...env, PATH: process.env.PATH ?? "" });
  expect(checkout.code).toBe(0);
  const names = (text: string) =>
    text.split("\n").filter((l) => /^ {2}\S/.test(l)).map((l) => l.trim().split(/\s+/)[0]);
  const fromExe = names(exe.out);
  expect(fromExe.length).toBeGreaterThan(10);
  expect(fromExe).toEqual(names(checkout.out));
  const verbs = readdirSync(join(CHECKOUT, "src/verbs"))
    .filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))
    .map((n) => n.replace(/\.ts$/, ""));
  for (const v of verbs) expect(fromExe).toContain(v);
  for (const args of [["search"], ["removed"], ["find"]]) {
    const r = run([copy, ...args], dir, env);
    expect(r.code, r.err).toBe(0);
    expect(r.out + r.err).not.toMatch(/ENOENT|no such file|not found|missing|cannot find/i);
  }
});

test("49.2 (no browser) the executable alone serves and writes no new folder beside itself", async () => {
  const { dir, copy } = emptyFolderWith(rel.root, join(rel.out, `werk-${HERE}`));
  const before = readdirSync(dir).sort();
  const child = Bun.spawn([copy, "serve", "--port", "0"], {
    cwd: dir,
    env: { PATH: NO_BUN_PATH, HOME: join(rel.root, "home"), WERK_HOME: join(rel.root, "wh2"), WERK_OPEN: "true" },
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    const reader = child.stdout.getReader();
    let seen = "";
    const dec = new TextDecoder();
    const end = Date.now() + 30000;
    while (!/serving on (http:\/\/127\.0\.0\.1:\d+)/.test(seen) && Date.now() < end) {
      const { value, done } = await reader.read();
      if (done) break;
      seen += dec.decode(value);
    }
    const address = /serving on (http:\/\/127\.0\.0\.1:\d+)/.exec(seen)?.[1];
    expect(address, seen).toBeTruthy();
    const page = await fetch(`${address}/`);
    expect(page.status).toBe(200);
    const html = await page.text();
    const assets = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1]);
    expect(assets.length).toBeGreaterThan(0);
    for (const a of assets) expect((await fetch(`${address}${a}`)).status).toBe(200);
  } finally {
    child.kill();
  }
  // The only new entry is .werk, the project's own map folder that every serve keeps. No client, verb or subagent file is unpacked.
  const added = readdirSync(dir).filter((n) => !before.includes(n));
  expect(added.every((n) => n === ".werk")).toBe(true);
  const files = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && !e.parentPath.includes(".git"))
    .map((e) => e.name);
  console.log("files in the folder after serve:", files);
  expect(files.filter((n) => /\.(html|js|css|md|ts)$/.test(n))).toEqual([]);
}, 60000);
