/** The eight checks on one ticket, each read from the ticket file alone (#st-ticket-own-checks). Pure. */
import {
  HEADER_FIELDS,
  listOf,
  SECTION_HEADINGS,
  sectionOf,
  type Ticket,
} from "./ticket-parse.ts";

export type Failure = {
  /** The ticket file, or "ticket set" for a failure no ticket owns. */
  ticket: string;
  check: string;
  field: string;
  message: string;
};

export const MAX_SIZE = 4000;

const EXTENSION = /\.[A-Za-z0-9]{1,5}$/;
const PATH = /^\/?(?:[\w.~*-]+\/)+[\w.*-]*\.[A-Za-z0-9]{1,5}$/;
const BULLET = /^\s*-\s+\S/;
const MAKE_BULLET = /^\s*-\s+`?make [A-Za-z0-9_.-]+`?\s*$/;

/** The paths in one line: a token with a slash between name characters that ends in an extension. */
export function pathsIn(line: string): string[] {
  const found: string[] = [];
  for (const raw of line.split(/\s+/)) {
    const token = raw.replace(/^[("'`[]+/, "").replace(/[.,;:!?)\]"'`]+$/, "");
    if (token.includes("://")) continue;
    if (PATH.test(token)) found.push(token);
  }
  return found;
}

export function ownChecks(ticket: Ticket): Failure[] {
  const failures: Failure[] = [];
  const fail = (check: string, field: string, message: string) =>
    failures.push({ ticket: ticket.file, check, field, message });

  // title: the title line exists, since the file parsed. Its text can still be empty.
  if (ticket.headers.title?.value === "") {
    fail("title", "title", "the title line has no text");
  }

  // shape: every header line and section heading, in order.
  let last = 0;
  for (const name of HEADER_FIELDS) {
    const header = ticket.headers[name];
    if (!header) fail("shape", name, `missing header line "${name}:"`);
    else if (header.line < last) {
      fail("shape", name, `header line "${name}:" is out of order`);
    } else last = header.line;
  }
  last = 0;
  for (const heading of SECTION_HEADINGS) {
    const section = sectionOf(ticket, heading);
    if (!section)
      fail("shape", `## ${heading}`, `missing heading "## ${heading}"`);
    else if (section.line < last) {
      fail("shape", `## ${heading}`, `heading "## ${heading}" is out of order`);
    } else last = section.line;
  }

  if (ticket.text.length > MAX_SIZE) {
    fail(
      "size",
      "file",
      `${ticket.text.length} characters, the limit is ${MAX_SIZE}`,
    );
  }

  const what = sectionOf(ticket, "What to build");
  if (!what?.body.some((entry) => entry.text.trim() !== "")) {
    fail("what-to-build", "## What to build", "the section has no text");
  }

  const acceptance = sectionOf(ticket, "Acceptance criteria");
  if (!acceptance?.body.some((e) => BULLET.test(e.text))) {
    fail("acceptance", "## Acceptance criteria", "the section has no bullet");
  }

  const paths: string[] = [];
  ticket.lines.forEach((text, index) => {
    for (const path of pathsIn(text)) paths.push(`${path} (line ${index + 1})`);
  });
  if (ticket.filesLine !== null) {
    paths.unshift(`a "files:" line (line ${ticket.filesLine})`);
  }
  if (paths.length > 0) {
    fail("no-file-paths", "file", `names a file path: ${paths.join(", ")}`);
  }

  const checks = sectionOf(ticket, "Checks");
  for (const entry of checks?.body ?? []) {
    if (BULLET.test(entry.text) && !MAKE_BULLET.test(entry.text)) {
      fail(
        "make-targets",
        "## Checks",
        `line ${entry.line} is not "make <target>": ${entry.text.trim()}`,
      );
    }
  }

  // touches: a missing line is the shape check's failure, not a second one here.
  const touches = ticket.headers.touches;
  if (touches) {
    const names = listOf(touches.value);
    if (names.length === 0) {
      fail("touches", "touches", "the line names no module");
    }
    for (const name of names) {
      if (/[\\/]/.test(name) || EXTENSION.test(name)) {
        fail("touches", "touches", `"${name}" reads as a path, not a module`);
      }
    }
  }
  return failures;
}
