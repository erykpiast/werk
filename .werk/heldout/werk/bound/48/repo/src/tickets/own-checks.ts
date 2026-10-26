// The eight checks on one ticket, each read from the ticket file alone (#st-ticket-own-checks).
import {
  HEADER_NAMES,
  type HeaderName,
  listOf,
  type ParsedTicket,
  parseTicket,
  SECTION_NAMES,
  sectionOf,
} from "./parse.ts";
import type { Failure } from "./report.ts";

export const SIZE_LIMIT = 4000;

/** What the set checks read from a ticket that passed its own checks (#st-ticket-set-checks). */
export type TicketFields = {
  cites: string[];
  blockedBy: number[];
  stories: number[];
};

export type OwnResult = { failures: Failure[]; fields: TicketFields };

const EXTENSION = /\.[A-Za-z0-9]{1,5}$/;
// A path: name characters, at least one `/` between two of them, and a file extension at the end.
// The look-behind keeps a URL's host and path, and a slash command, from counting.
const PATH = /(?<![\w*.\-/:])[\w*.-]+(?:\/[\w*.-]+)+\.[A-Za-z0-9]{1,5}(?![\w*/-])/g;
const BULLET = /^\s*[-*][ \t]+(.*?)\s*$/;
const CRITERION = /^\s*-[ \t]+(\[[ xX]\][ \t]+)?\S/;
const MAKE_TARGET = /^make [A-Za-z0-9_.-]+$/;

/** The card id without one leading hash sign (#werk-cli-hash-id). */
const citedId = (entry: string) => (entry.startsWith("#") ? entry.slice(1) : entry);

function numbers(ticket: ParsedTicket, name: HeaderName, failures: Failure[]): number[] {
  const out: number[] = [];
  for (const entry of listOf(ticket.headers[name]?.value)) {
    if (/^\d+$/.test(entry)) out.push(Number(entry));
    else failures.push({ check: "shape", field: name, message: `"${entry}" is not a number` });
  }
  return out;
}

/** The field a line sits in: its header name, its section heading, or the header. */
function placeOf(ticket: ParsedTicket, n: number): string {
  const section = ticket.sections.findLast((each) => each.line <= n);
  if (section !== undefined) return section.name;
  return HEADER_NAMES.find((name) => ticket.headers[name]?.line === n) ?? "header";
}

function shape(ticket: ParsedTicket, failures: Failure[]): void {
  for (const name of HEADER_NAMES) {
    if (ticket.headers[name] === undefined)
      failures.push({ check: "shape", field: name, message: `the line "${name}:" is missing` });
  }
  for (const name of SECTION_NAMES) {
    if (sectionOf(ticket, name) === undefined)
      failures.push({ check: "shape", field: name, message: `the heading "## ${name}" is missing` });
  }
  const headerLines = HEADER_NAMES.flatMap((name) => ticket.headers[name]?.line ?? []);
  if (headerLines.some((line, i) => i > 0 && line < (headerLines[i - 1] as number)))
    failures.push({
      check: "shape",
      field: "header",
      message: `the header lines are not in the order ${HEADER_NAMES.join(", ")}`,
    });
  const sectionLines = SECTION_NAMES.flatMap((name) => sectionOf(ticket, name)?.line ?? []);
  if (sectionLines.some((line, i) => i > 0 && line < (sectionLines[i - 1] as number)))
    failures.push({
      check: "shape",
      field: "sections",
      message: `the sections are not in the order ${SECTION_NAMES.join(", ")}`,
    });
}

function size(text: string, failures: Failure[]): void {
  const length = [...text].length;
  if (length > SIZE_LIMIT)
    failures.push({ check: "size", field: "file", message: `${length} characters; the limit is ${SIZE_LIMIT}` });
}

function whatToBuild(ticket: ParsedTicket, failures: Failure[]): void {
  const field = "What to build";
  const section = sectionOf(ticket, field);
  if (section === undefined) failures.push({ check: "what-to-build", field, message: "the section is missing" });
  else if (section.lines.every((line) => line.text.trim() === ""))
    failures.push({ check: "what-to-build", field, message: "the section has no text" });
}

function acceptance(ticket: ParsedTicket, failures: Failure[]): void {
  const field = "Acceptance criteria";
  const section = sectionOf(ticket, field);
  if (section === undefined) failures.push({ check: "acceptance", field, message: "the section is missing" });
  else if (!section.lines.some((line) => CRITERION.test(line.text)))
    failures.push({ check: "acceptance", field, message: "the section has no bullet" });
}

function noFilePaths(ticket: ParsedTicket, failures: Failure[]): void {
  for (const line of ticket.lines) {
    if (/^files:/.test(line.text))
      failures.push({
        check: "no-file-paths",
        field: "files",
        message: `line ${line.n}: a files line names file paths`,
      });
    for (const match of line.text.matchAll(PATH)) {
      failures.push({
        check: "no-file-paths",
        field: placeOf(ticket, line.n),
        message: `line ${line.n}: ${match[0]}`,
      });
    }
  }
}

function makeTargets(ticket: ParsedTicket, failures: Failure[]): void {
  for (const line of sectionOf(ticket, "Checks")?.lines ?? []) {
    const bullet = BULLET.exec(line.text);
    if (bullet === null) continue;
    const command = (bullet[1] as string).replace(/^`(.*)`$/, "$1").trim();
    if (!MAKE_TARGET.test(command))
      failures.push({
        check: "make-targets",
        field: "Checks",
        message: `line ${line.n}: "${command}" is not make <target>`,
      });
  }
}

function touches(ticket: ParsedTicket, failures: Failure[]): void {
  const names = listOf(ticket.headers.touches?.value);
  if (names.length === 0) failures.push({ check: "touches", field: "touches", message: "names no module" });
  for (const name of names) {
    if (/[/\\]/.test(name) || EXTENSION.test(name))
      failures.push({ check: "touches", field: "touches", message: `"${name}" reads as a path, not a module name` });
  }
}

/** Runs the eight checks on one file. A file with no title is not parsed further. */
export function ownChecks(file: string, text: string): OwnResult {
  const ticket = parseTicket(text);
  const failures: Failure[] = [];
  const empty: TicketFields = { cites: [], blockedBy: [], stories: [] };
  if ((ticket.headers.title?.value ?? "") === "") {
    failures.push({ check: "title", field: "title", message: 'the file has no line "title: <text>"' });
    return { failures: failures.map((failure) => ({ ticket: file, ...failure })), fields: empty };
  }
  shape(ticket, failures);
  const fields: TicketFields = {
    cites: listOf(ticket.headers.cites?.value).map(citedId),
    blockedBy: numbers(ticket, "blocked_by", failures),
    stories: numbers(ticket, "stories", failures),
  };
  size(text, failures);
  whatToBuild(ticket, failures);
  acceptance(ticket, failures);
  noFilePaths(ticket, failures);
  makeTargets(ticket, failures);
  touches(ticket, failures);
  return { failures: failures.map((failure) => ({ ticket: file, ...failure })), fields };
}
