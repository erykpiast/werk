// Helpers for the held-out tests. They drive the real command line in a fresh project (#werk-test-store).
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fold, parseLog } from "../src/map/fold.ts";
import { useProject, type Project } from "../src/test-env/project.ts";

export const CLI = join(import.meta.dir, "..", "src", "cli.ts");

export type Werk = {
  project: () => Project;
  /** Runs `werk <args>` in the project. */
  run: (...args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
  /** Appends raw events to the map log, as an earlier session would have left them. */
  seed: (...events: unknown[]) => void;
  /** The number of lines in the map log. */
  logLines: () => number;
  write: (path: string, text: string) => void;
};

export function useWerk(): Werk {
  const project = useProject();
  const logPath = () => project().logPath;
  return {
    project,
    run: (...args) => project().run(["bun", CLI, ...args]),
    seed: (...events) => {
      mkdirSync(join(project().dir, ".werk"), { recursive: true });
      const text = existsSync(logPath()) ? readFileSync(logPath(), "utf8") : "";
      writeFileSync(
        logPath(),
        text + events.map((e) => `${JSON.stringify(e)}\n`).join(""),
      );
      // A seed that the fold refuses is a mistake in the test, not a product failure.
      const { problems } = fold(parseLog(readFileSync(logPath(), "utf8")));
      if (problems.length > 0) {
        throw new Error(`binder error: the seeded log has problems: ${JSON.stringify(problems)}`);
      }
    },
    logLines: () =>
      existsSync(logPath())
        ? readFileSync(logPath(), "utf8").split("\n").filter((l) => l !== "").length
        : 0,
    write: (path, text) => {
      const full = join(project().dir, path);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, text);
    },
  };
}

type CardOptions = {
  parent?: string;
  status?: "open" | "proto" | "decided";
  title?: string;
  why?: string;
  body?: string;
};

/**
 * The events of a real card in the map: proposed, then accepted by the person.
 * A decided card carries the four facts by waiver, so the contract check passes.
 */
export function card(id: string, options: CardOptions = {}): unknown[] {
  const { parent, status = "open", title = id, why = "", body } = options;
  // A decided card cannot start under a parent that is not decided (the contract waits on the
  // parent), so it is decided first and linked to its parent with a refines link afterwards.
  const late = status === "decided" && parent !== undefined;
  const events: unknown[] = [
    {
      type: "node.proposed",
      id,
      kind: "card",
      title,
      why,
      ...(body === undefined ? {} : { body }),
      status: status === "decided" ? "open" : status,
      ...(parent === undefined || late ? {} : { parent }),
    },
    { type: "node.accepted", id, actor: "you" },
  ];
  if (status === "decided") {
    events.push(
      { type: "node.edited", id, who: "me" },
      { type: "node.edited", id, noBasis: "set by the test" },
      { type: "criterion.added", id, form: "revisit" },
      { type: "node.decided", id },
    );
    if (late) events.push(link(id, parent, "refines", ""));
  }
  return events;
}

export const link = (from: string, to: string, type: string, why = "w") => ({
  type: "edge.added",
  from,
  to,
  link: type,
  why,
});
