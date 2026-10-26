import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cloneCheckout, PLAIN_PATH, sh } from "./clone.ts";

test("61.3 tests pass with no claude on PATH, from temporary projects, leaving the tree clean", async () => {
  const { dir, done } = cloneCheckout();
  try {
    // No `claude` is reachable on the plain PATH.
    expect(sh(dir, ["sh", "-c", "command -v claude || echo none"]).out.trim()).toBe("none");
    expect(sh(dir, ["bun", "install", "--frozen-lockfile"]).code).toBe(0);
    const before = sh(dir, ["git", "status", "--porcelain"]).out;
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldoutA-tmp-")));
    const proc = Bun.spawn(["make", "test"], {
      cwd: dir,
      env: { HOME: process.env.HOME ?? "/tmp", PATH: PLAIN_PATH, TMPDIR: tmp },
      stdout: "pipe",
      stderr: "pipe",
    });
    let scriptsWithEvents = 0;
    let scriptsWithEdit = 0;
    let launchFiles = 0;
    const seen = new Set<string>();
    const poll = setInterval(() => {
      for (const name of readdirSync(tmp)) {
        if (!name.startsWith("werk-test-")) continue;
        const fake = join(tmp, name, "fake-agent");
        try {
          const script = join(fake, "script.json");
          if (existsSync(script) && !seen.has(script)) {
            const text = readFileSync(script, "utf8");
            if (text.length > 0) {
              seen.add(script);
              if (/"edit"/.test(text)) scriptsWithEdit++;
              if (/"replies"/.test(text)) scriptsWithEvents++;
            }
          }
          if (existsSync(join(fake, "launches.jsonl")) && !seen.has(fake)) {
            seen.add(fake);
            launchFiles++;
          }
        } catch {}
      }
    }, 20);
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    clearInterval(poll);
    console.log("make test exit", code, (out + err).slice(-600));
    console.log({ scriptsWithEvents, scriptsWithEdit, launchFiles });
    const after = sh(dir, ["git", "status", "--porcelain"]).out;
    console.log("git status before/after", JSON.stringify(before), JSON.stringify(after));
    expect(code).toBe(0);
    expect(scriptsWithEvents).toBeGreaterThan(0);
    expect(scriptsWithEdit).toBeGreaterThan(0);
    expect(launchFiles).toBeGreaterThan(0);
    expect(after).toBe(before);
    expect(after).toBe("");
  } finally {
    done();
  }
}, 1_800_000);
