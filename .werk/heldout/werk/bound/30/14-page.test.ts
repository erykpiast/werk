import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { useProject } from "../src/test-env/project.ts";
import { CLI, card, seedLog } from "./helpers.ts";

const project = useProject();

// 14.1 and 14.3 need a page with the map and a chat composer. Probe what the served page holds.
test("14.1/14.3 the served page shows the map and holds a chat composer", async () => {
  const p = project();
  seedLog(p, card("root", "Root", "open"));
  p.start(["bun", CLI, "serve", "--port", "0"]);
  const lock = join(p.dir, ".werk", "serve.lock");
  let port = 0;
  for (let i = 0; i < 100 && port === 0; i++) {
    await Bun.sleep(50);
    if (existsSync(lock)) port = JSON.parse(readFileSync(lock, "utf8")).port ?? 0;
  }
  expect(port).toBeGreaterThan(0);
  const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  expect(html).toContain("Root");
  expect(html).toMatch(/textarea|contenteditable/i);
  expect(existsSync(join(import.meta.dir, "..", "client"))).toBe(true);
});
