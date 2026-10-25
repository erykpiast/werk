import { afterEach, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildLaunchOptions } from "../agent/launch-options.ts";
import {
  isExecutable,
  ownFiles,
  registerOwnFiles,
  selfCommand,
  selfCommandLine,
} from "./own.ts";
import { embeddedClient } from "./own-client.ts";

afterEach(() => {
  // A checkout registers nothing: put that state back.
  registerOwnFiles(null);
});

test("a checkout names its own cli behind the runtime", () => {
  expect(isExecutable()).toBe(false);
  const [runtime, cli] = selfCommand();
  expect(runtime).toBe(process.execPath);
  expect(cli).toEndWith("src/cli.ts");
});

test("a release executable names itself alone, in a child command and in the agent prompt", () => {
  registerOwnFiles({ verbs: [], client: {} });
  expect(selfCommand()).toEqual([process.execPath]);
  expect(selfCommandLine()).toBe(`"${process.execPath}"`);
  const options = buildLaunchOptions({
    role: "builder",
    werk: selfCommandLine(),
    projectIsWerk: false,
    buildRuleTitles: [],
  });
  expect(options.appendSystemPrompt).toContain(`"${process.execPath}" help`);
  expect(options.appendSystemPrompt).not.toContain("cli.ts");
  expect(options.appendSystemPrompt).not.toContain("--hot");
});

test("the registered list replaces the checkout's list", () => {
  const client = { "/index.html": "/x" };
  registerOwnFiles({ verbs: [], client });
  expect(ownFiles().client).toBe(client);
  expect(isExecutable()).toBe(true);
});

test("an embedded client serves its page with the token and its files, and nothing else", async () => {
  const dir = join(import.meta.dir);
  const page = join(dir, "own.ts");
  const client = embeddedClient({ "/index.html": page, "/assets/a.js": page });
  expect(client).not.toBeNull();
  const html = await client?.page("tok");
  expect(html?.status).toBe(200);
  const asset = await client?.asset(new Request("http://x/assets/a.js"));
  expect(asset?.status).toBe(200);
  expect(
    await client?.asset(new Request("http://x/assets/none.js")),
  ).toBeNull();
});

test("a list with no page gives no client", () => {
  expect(embeddedClient({})).toBeNull();
});

/** The code that werk runs from finds its own files in the list, never in a folder listing. */
test("no code that finds werk's own files lists a folder", () => {
  const src = join(import.meta.dir, "..");
  const skipped = new Set([
    "release",
    "test",
    "test-env",
    "claude",
    "verbs",
    "tickets",
  ]);
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        if (!skipped.has(name)) walk(path);
      } else if (
        /\.tsx?$/.test(name) &&
        !name.endsWith(".test.ts") &&
        name !== "verb-names.macro.ts" &&
        /readdir|Bun\.Glob|scanSync|opendir/.test(readFileSync(path, "utf8"))
      ) {
        offenders.push(path);
      }
    }
  };
  walk(src);
  expect(offenders).toEqual([]);
});
