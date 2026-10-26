import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { cleanEnv } from "../src/test/clean-env.ts";
import { FAKE_DIR_VAR, LAUNCHES_FILE, type LaunchEntry, SCRIPT_FILE } from "../src/test/fake-script.ts";
import { Harness } from "../e2e/harness.ts";

const CHECKOUT = fileURLToPath(new URL("..", import.meta.url));
const FAKE_BIN = join(CHECKOUT, "src/test/fake-bin");
const FIXTURE = join(CHECKOUT, "e2e/fixtures/project");
const EXE_SRC = "/var/folders/xc/_stjh9891jq3t3gsp9j1vy4h0000gn/T/heldout-repo-AU3QVg/clone/dist/bin/werk-darwin-arm64";

const roots: string[] = [];
const procs: ChildProcess[] = [];
test.afterEach(() => {
  for (const p of procs.splice(0)) if (p.exitCode === null) p.kill("SIGKILL");
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

function setup(script: object = { roles: {} }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "heldout-exe-")));
  roots.push(root);
  const exeDir = join(root, "bin");
  mkdirSync(exeDir);
  const exe = join(exeDir, "werk");
  copyFileSync(EXE_SRC, exe);
  chmodSync(exe, 0o755);
  const dir = join(root, "project");
  cpSync(FIXTURE, dir, { recursive: true });
  const fake = join(root, "fake");
  mkdirSync(fake);
  writeFileSync(join(fake, SCRIPT_FILE), JSON.stringify(script));
  const env = { ...cleanEnv(process.env, FAKE_BIN), [FAKE_DIR_VAR]: fake };
  const proc = spawn(exe, ["serve", "--port", "0"], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
  procs.push(proc);
  let err = "";
  proc.stderr?.on("data", (c: Buffer) => (err += c.toString()));
  const url = new Promise<string>((resolve, reject) => {
    let out = "";
    proc.stdout?.on("data", (c: Buffer) => {
      out += c.toString();
      const f = /http:\/\/\S+/.exec(out);
      if (f) resolve(f[0].replace(/\/map$/, ""));
    });
    proc.on("exit", (code) => reject(new Error(`exe exited ${code}: ${err}`)));
  });
  const launches = () => {
    const f = join(fake, LAUNCHES_FILE);
    return existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as LaunchEntry) : [];
  };
  return { root, exe, dir, env, proc, url, launches, err: () => err };
}

test("[41.1] the executable alone serves the map and the client", async ({ page: p }) => {
  const w = setup();
  const url = await w.url;
  const errors: string[] = [];
  p.on("pageerror", (e) => errors.push(`pageerror ${e.message}`));
  p.on("console", (m) => m.type() === "error" && errors.push(`console ${m.text()}`));
  p.on("response", (r) => r.status() >= 400 && errors.push(`http ${r.status()} ${r.url()}`));
  // nothing next to the executable
  expect(existsSync(join(w.root, "bin", "node_modules"))).toBe(false);
  expect(existsSync(join(w.root, "bin", "src"))).toBe(false);
  expect(existsSync(join(w.root, "bin", "dist"))).toBe(false);
  await p.goto(`${url}/map`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Ship the checkout");
  await expect(p.locator("a[data-tile]")).toHaveCount(2);
  await p.waitForLoadState("networkidle");
  await expect(p.getByRole("complementary", { name: "Chat" })).toBeVisible();
  await p.locator('a[data-tile="retry"]').click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Retry a failed payment once");
  await expect(p.locator('[data-field="body"]')).toContainText("A second failure goes back to");
  expect(errors).toEqual([]);
});

test("[41.2] a prompt built in the executable names the executable", async ({ page: p }) => {
  const stream = (event: object) => ({ event: { type: "stream_event", event } });
  const w = setup({
    roles: {
      chat: {
        replies: [[stream({ type: "message_start", message: { id: "m1" } }), stream({ type: "content_block_start", index: 0, content_block: { type: "text", text: "On it." } }), { event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "On it." }] } } }]],
      },
    },
  });
  const url = await w.url;
  await p.goto(`${url}/map`);
  const pane = p.getByRole("complementary", { name: "Chat" });
  await pane.getByRole("textbox", { name: "Message" }).fill("Add a card to the map about retries");
  await pane.getByRole("button", { name: "Send" }).click();
  await expect(pane.locator(".msg.agent")).toHaveText("On it.");
  const launch = w.launches().find((e) => e.kind === "launch") as { args: string[] };
  const prompt = launch.args[launch.args.indexOf("--append-system-prompt") + 1] as string;
  const agents = launch.args[launch.args.indexOf("--agents") + 1] as string;
  console.log("EXE PATH", w.exe);
  expect(prompt).toContain(w.exe);
  expect(prompt).not.toMatch(/\b(bun|node|deno)\s+\S+\.(ts|js)\b/);
  expect(prompt).not.toContain("src/cli.ts");
  expect(agents).toContain(w.exe);
  expect(agents).not.toContain("src/cli.ts");
  // the agent runs a werk command by that path
  const run = spawnSync(w.exe, ["add", "retries", "--title", "Retries card from the agent", "--parent", "root"], { cwd: w.dir, env: w.env, encoding: "utf8" });
  console.log("AGENT COMMAND:", run.status, run.stdout, run.stderr);
  expect(run.status).toBe(0);
  await expect(p.locator("#view")).toContainText("Retries card from the agent");
});

test("[41.3] commands werk shows and child processes name the executable", async () => {
  const w = setup();
  await w.url;
  const r = spawnSync(w.exe, ["status", "retry", "decided"], { cwd: w.dir, env: w.env, encoding: "utf8" });
  console.log("SHOWN COMMANDS:\n", r.stderr || r.stdout);
  const shown = (r.stderr + r.stdout).split("\n").filter((l) => /^\s*(or: |then: )?\S+ (edit|link|add|kill|status|rederive) /.test(l));
  expect(shown.length).toBeGreaterThan(0);
  for (const l of shown) expect(l).toContain(w.exe);
  const ps = spawnSync("ps", ["-A", "-o", "pid=,ppid=,command="], { encoding: "utf8" }).stdout.split("\n");
  const kids = ps.filter((l) => l.trim().split(/\s+/)[1] === String(w.proc.pid));
  console.log("CHILDREN OF THE EXECUTABLE:", kids);
  expect(kids.filter((k) => /\b(bun|node)\b.*\.ts/.test(k))).toEqual([]);
});

test("[41.4] a checkout serves the client and prompts as before", async ({ page: p }) => {
  const fake = mkdtempSync(join(tmpdir(), "heldout-fake41-"));
  roots.push(fake);
  const stream = (event: object) => ({ event: { type: "stream_event", event } });
  writeFileSync(join(fake, SCRIPT_FILE), JSON.stringify({ roles: { chat: { replies: [[stream({ type: "message_start", message: { id: "m1" } }), stream({ type: "content_block_start", index: 0, content_block: { type: "text", text: "Got it." } }), { event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "Got it." }] } } }]] } } }));
  const harness = new Harness();
  try {
    const w = await harness.start({ env: { ...process.env, [FAKE_DIR_VAR]: fake } });
    await p.goto(`${w.url}/map`);
    await expect(p.getByRole("heading", { level: 1 })).toHaveText("Ship the checkout");
    await expect(p.locator("a[data-tile]")).toHaveCount(2);
    const pane = p.getByRole("complementary", { name: "Chat" });
    await pane.getByRole("textbox", { name: "Message" }).fill("Hello agent");
    await pane.getByRole("button", { name: "Send" }).click();
    await expect(pane.locator(".msg.agent")).toHaveText("Got it.");
    const l = readFileSync(join(fake, LAUNCHES_FILE), "utf8").split("\n").filter(Boolean).map((x) => JSON.parse(x) as LaunchEntry);
    const launch = l.find((e) => e.kind === "launch") as { args: string[] };
    const prompt = launch.args[launch.args.indexOf("--append-system-prompt") + 1] as string;
    expect(prompt).toContain(join(w.app, "src", "cli.ts"));
  } finally {
    await harness.close();
  }
});
