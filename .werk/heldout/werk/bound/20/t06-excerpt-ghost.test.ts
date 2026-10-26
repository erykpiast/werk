import { expect, test } from "bun:test";
import { useProject } from "../src/test-env/project.ts";
import { all, decided, edge, ghost, real, seed, werk } from "./helpers.ts";

const project = useProject();

const excerptGhost = {
  type: "node.proposed",
  id: "ex",
  kind: "excerpt",
  title: "Maria",
  body: "We must ship by June.",
  status: "open",
};

test("06.1 the agent adds an excerpt: the command says proposed", async () => {
  const p = project();
  seed(p, decided("c", { title: "Ship date", why: "the launch" }));
  const add = await werk(
    p,
    "add",
    "ex",
    "--kind",
    "excerpt",
    "--title",
    "Maria",
    "--body",
    "We must ship by June.",
  );
  expect(all(add)).toContain("proposed");
  expect(add.code).toBe(0);
  const link = await werk(p, "link", "c", "ex", "--type", "supported_by");
  expect(link.code).toBe(0);
  const shown = await werk(p, "show", "c");
  expect(shown.stdout).toContain("[decided]");
  expect(shown.stdout).toContain("Ship date");
  expect(shown.stdout).toMatch(/supported_by\s+ex .*\[proposed\]\s+\[held\]/);
});

test("06.1 (map state, excerpt seeded by log events)", async () => {
  const p = project();
  seed(p, decided("c", { title: "Ship date", why: "the launch" }));
  seed(p, excerptGhost, edge("c", "ex", "supported_by", "the quote backs it"));
  const shown = await werk(p, "show", "c");
  expect(shown.stdout).toContain("[decided]");
  expect(shown.stdout).toContain("Ship date");
  expect(shown.stdout).toContain("why: the launch");
  expect(shown.stdout).toMatch(/supported_by\s+ex .*\[proposed\]\s+\[held\]/);
  const ex = await werk(p, "show", "ex");
  expect(ex.stdout).toContain("proposed");
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async () => {
  const p = project();
  seed(p, decided("c", { title: "Ship date" }));
  seed(p, excerptGhost, edge("c", "ex", "supported_by", "the quote backs it"));
  const before = await werk(p, "show", "ex");
  expect(before.stdout).toContain("proposed");
  const accepted = await werk(p, "accept", "ex", "--actor", "you");
  expect(all(accepted)).toContain("accepted");
  expect(accepted.code).toBe(0);
  const after = await werk(p, "show", "ex");
  expect(after.stdout).not.toContain("proposed");
  const card = await werk(p, "show", "c");
  const row = card.stdout.split("\n").find((l) => l.includes("supported_by"));
  expect(row).toBeDefined();
  expect(row).toContain("ex");
  expect(row).not.toContain("[held]");
  expect(row).not.toContain("[proposed]");
  // no second accept was given for the link
  expect(
    p.events().filter((e) => (e as { type: string }).type === "node.accepted")
      .length,
  ).toBe(2);
});

void ghost;
void real;
