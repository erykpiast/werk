// Held-out steps 15.x and 19.1-19.4. Each starts from what a person does: open the map in a
// browser, send a chat message, start a build pass or sample options. The test looks for the
// command that starts each of these and, where it exists, would drive it.
import { expect, test } from "bun:test";
import { project, real } from "./helpers.ts";

async function verbs(): Promise<string[]> {
  const p = project();
  const help = await p.w("help");
  return [...help.out.matchAll(/^ {2}([a-z-]+)\b/gm)].map((m) => m[1] as string);
}

const mapServer = async () => {
  const p = project();
  const serve = await p.w("serve");
  return { serve, verbs: await verbs() };
};

for (const id of ["15.1", "15.2", "15.3", "15.4", "15.5"]) {
  test(id, async () => {
    // The person opens a card in the map: werk must serve the map. `make dev` runs `werk serve`.
    const { serve, verbs: list } = await mapServer();
    expect(list).toContain("serve");
    expect(serve.err).not.toContain("unknown verb");
  });
}

for (const id of ["19.1", "19.3", "19.4"]) {
  test(id, async () => {
    const p = project();
    p.seed([real("how", "Build rules"), real("ticket", "A ticket")]);
    const list = await verbs();
    // The person starts a build pass on a ticket.
    const starter = list.find((v) => /build|run|loop|pass/.test(v));
    expect(starter).toBeDefined();
    const run = await p.w(starter as string, "ticket");
    expect(run.code).toBe(0);
    expect(p.launches().length).toBeGreaterThan(0);
  });
}

test("19.2", async () => {
  const list = await verbs();
  // The person sends a chat message and samples options for an open card.
  expect(list.some((v) => /chat|serve/.test(v))).toBe(true);
  expect(list.some((v) => /sample/.test(v))).toBe(true);
});
