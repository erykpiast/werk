// 15.x: the person opens a card in the map. The test starts werk the way `make dev` does
// (`bun src/cli.ts serve`) in a fresh project and waits for the map to answer.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "cli.ts");

function startMap(bodies: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "werk-heldout-15-"));
  mkdirSync(join(dir, ".werk"));
  const lines = Object.entries(bodies).map(([id, body], i) =>
    JSON.stringify({ seq: i + 1, at: "t", actor: "you", type: "node.added", payload: { id, kind: "card", title: id, body } }),
  );
  writeFileSync(join(dir, ".werk", "log.jsonl"), `${lines.join("\n")}\n`);
  return spawnSync(process.execPath.includes("bun") ? process.execPath : "bun", [CLI, "serve"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 10000,
  });
}

for (const [id, bodies] of [
  ["15.1", { "al-diff": "x", align: "y", "notes-test": "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too." }],
  ["15.2", { "al-diff": "x", guards: "--al-diff\n\n##al-diff\n\n# al-diff\n\nAnd #al-diff." }],
  ["15.3", { "code-sample": "```zsh\necho $HOME | grep -v x\n```" }],
  ["15.4", { unsafe: "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~" }],
  ["15.5", { "al-diff": "x", "tile-card": "Depends on #al-diff" }],
] as const) {
  test(`${id} the person opens a card in the map`, async ({ page }) => {
    const run = startMap(bodies as Record<string, string>);
    console.log(`${id} serve: status=${run.status} stderr=${(run.stderr ?? "").split("\n")[0]}`);
    const url = /https?:\/\/\S+/.exec(`${run.stdout}${run.stderr}`)?.[0];
    expect(url, "werk printed a map address").toBeDefined();
    await page.goto(`${url}/map/${Object.keys(bodies).at(-1)}`);
  });
}
