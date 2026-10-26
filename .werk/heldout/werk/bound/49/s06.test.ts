import { expect, setDefaultTimeout, test } from "bun:test";
import { createProject, decide, makeWerk, real, type W } from "./support.ts";

setDefaultTimeout(120000);

async function withW<T>(body: (w: W, p: ReturnType<typeof createProject>) => Promise<T>) {
  const p = createProject();
  try {
    return await body(makeWerk(p), p);
  } finally {
    await p.dispose();
  }
}

test("06.1 a new excerpt for a decided card stages as a ghost", () =>
  withW(async (w) => {
    await real(w, "card", "Decided card");
    await decide(w, "card");
    const added = await w("add", "ex1", "--kind", "excerpt", "--title", "Ana", "--body", "We keep it exactly like this");
    expect(added.stdout.trim()).toBe("proposed");
    expect(added.code).toBe(0);
    expect((await w("link", "card", "ex1", "--type", "supported_by", "--why", "said so")).code).toBe(0);
    const shown = await w("show", "card");
    expect(shown.stdout).toMatch(/supported_by\s+ex1.*\[proposed\]/);
    expect(shown.stdout).toContain("[decided]");
  }));

test("06.2 an accepted excerpt stops being a ghost and its link goes live", () =>
  withW(async (w) => {
    await real(w, "card", "Decided card");
    await decide(w, "card");
    const added = await w("add", "ex1", "--kind", "excerpt", "--title", "Ana", "--body", "Words");
    expect(added.code).toBe(0);
    expect((await w("link", "card", "ex1", "--type", "supported_by", "--why", "w")).code).toBe(0);
    expect((await w("accept", "ex1", "--actor", "you")).code).toBe(0);
    const shown = await w("show", "card");
    expect(shown.stdout).toMatch(/supported_by\s+ex1/);
    expect(shown.stdout).not.toMatch(/ex1.*\[proposed\]/);
    expect(shown.stdout).not.toMatch(/ex1.*\[held\]/);
  }));
