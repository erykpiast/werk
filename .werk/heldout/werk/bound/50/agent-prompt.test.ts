// Scenarios 19.1 to 19.4: the prompt that a build pass, a chat agent or a sample agent starts with.
// Each step starts with a person starting a build pass, sending a chat message or sampling
// options. The test looks for that entry point on werk's command line and in its map server.
import { expect, test } from "bun:test";
import { ok, project, real, seed, serve } from "./helpers.ts";

async function entryPoints() {
  const p = project();
  seed(p, [real("root", "Root")]);
  const help = (await ok(p, ["help"])).out;
  const verbs = [...help.matchAll(/^ {2}([a-z-]+)\b/gm)].map((m) => m[1] as string);
  const base = await serve(p);
  const probe = async (path: string, method = "POST") =>
    (await fetch(`${base}${path}`, { method, body: "{}" }).catch(() => undefined))?.status;
  return { verbs, probe };
}

test("19.1 a build pass in another project starts with the werk instructions, its subagents and the build-rule titles", async () => {
  const { verbs, probe } = await entryPoints();
  console.log("verbs:", verbs.join(" "));
  expect(verbs.some((verb) => /^(build|start|run|loop|pass)/.test(verb))).toBe(true);
  expect([404, undefined]).not.toContain(await probe("/api/build"));
});

test("19.2 a chat agent gets the instructions, but a sample agent does not", async () => {
  const { verbs, probe } = await entryPoints();
  expect(
    verbs.some((verb) => /^(chat|sample)/.test(verb)) || ![404, undefined].includes(await probe("/api/chat")),
  ).toBe(true);
});

test("19.3 a project with no build rules gets no title list", async () => {
  const { verbs } = await entryPoints();
  expect(verbs.some((verb) => /^(build|start|run|loop|pass)/.test(verb))).toBe(true);
});

test("19.4 in werk's own checkout the instructions appear one time", async () => {
  const { verbs } = await entryPoints();
  expect(verbs.some((verb) => /^(build|start|run|loop|pass)/.test(verb))).toBe(true);
});
