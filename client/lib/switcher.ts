/** What the project switcher shows for each project, and what a click on a row does (#werk-projects-switcher). */
import type { ProjectInfo } from "./project-route";

/** A project as the server lists it. */
export type SwitcherProject = ProjectInfo & {
  folder: string;
  /** werk's own checkout in dev mode. It cannot be removed. */
  dev: boolean;
  /** The agent turns that run in the project now. */
  running: string[];
  /** The background tasks of the project's agent. */
  background: number;
  /** The error of a dead agent, or null. */
  dead: string | null;
};

export type SwitcherRow = {
  name: string;
  /** The folder with the home folder written as ~. */
  folder: string;
  busy: boolean;
  /** The agent exited without werk stopping it (#werk-mc-live-dead). */
  dead: boolean;
  missing: boolean;
  /** The row has a remove button on hover. The dev entry never has one. */
  removable: boolean;
};

const tilde = (folder: string, home: string | null) =>
  home && (folder === home || folder.startsWith(`${home}/`))
    ? `~${folder.slice(home.length)}`
    : folder;

export function rowsOf(
  projects: readonly SwitcherProject[],
  home: string | null = null,
): SwitcherRow[] {
  return projects.map((p) => ({
    name: p.name,
    folder: tilde(p.folder, home),
    busy: p.running.length > 0 || p.background > 0,
    dead: p.dead !== null,
    missing: p.missing,
    removable: !p.dev,
  }));
}

/** A click on a row opens its project, except a project whose folder is gone, and the project already open. */
export function pickOf(
  row: Pick<SwitcherRow, "name" | "missing">,
  current: string | null,
): "open" | "stay" | "refuse" {
  if (row.missing) return "refuse";
  return row.name === current ? "stay" : "open";
}

/** The question before a project with running turns is removed. The turns stop with it (#werk-projects-list). */
export function stopQuestion(name: string, running: readonly string[]): string {
  return `${name} has running agent turns: ${running.join(", ")}.\n\nStop them and remove the project?`;
}
