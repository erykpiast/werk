import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRecords } from "../src/fake-agent/launch-log.ts";
import type { Script } from "../src/fake-agent/script.ts";

export const BIN = join(import.meta.dirname, "../fake/claude");

export function fakeEnv() {
  const dir = mkdtempSync(join(tmpdir(), "werk-heldout-fake-"));
  const project = join(dir, "project");
  mkdirSync(project);
  const scriptPath = join(dir, "script.json");
  const install = (s: Script) => writeFileSync(scriptPath, JSON.stringify(s));
  function launch(role: string | undefined, args: string[] = [], withScript = true) {
    const env: Record<string, string> = { PATH: process.env.PATH ?? "" };
    if (withScript) env.WERK_FAKE_SCRIPT = scriptPath;
    if (role) env.WERK_AGENT_ROLE = role;
    const child = Bun.spawn(["bun", BIN, ...args], { cwd: project, env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    const lines: string[] = [];
    let rest = "";
    const waiters: (() => void)[] = [];
    const reading = (async () => {
      const dec = new TextDecoder();
      for await (const chunk of child.stdout) {
        rest += dec.decode(chunk, { stream: true });
        const parts = rest.split("\n");
        rest = parts.pop() ?? "";
        lines.push(...parts);
        for (const w of waiters.splice(0)) w();
      }
      for (const w of waiters.splice(0)) w();
    })();
    const stdin = child.stdin as import("bun").FileSink;
    return {
      child,
      lines,
      say(text: string) {
        stdin.write(`${JSON.stringify({ type: "user", message: { role: "user", content: text } })}\n`);
        stdin.flush();
      },
      send(line: string) {
        stdin.write(line);
        stdin.flush();
      },
      close() {
        stdin.end();
      },
      async waitFor(count: number, ms = 8000) {
        const end = Date.now() + ms;
        while (lines.length < count && Date.now() < end) {
          await Promise.race([new Promise<void>((w) => waiters.push(w)), Bun.sleep(100)]);
        }
        return lines.length >= count;
      },
      async finish() {
        const code = await child.exited;
        await reading;
        return { code, stdout: lines.map((l) => JSON.parse(l)), stderr: await new Response(child.stderr).text() };
      },
    };
  }
  return {
    dir,
    project,
    scriptPath,
    install,
    launch,
    records: () => readRecords(`${scriptPath}.launches.jsonl`),
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
}
