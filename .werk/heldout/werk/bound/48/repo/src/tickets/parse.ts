// Reads the fixed ticket format: five header lines, then three sections (#st-ticket-shape).
// The parser only finds the fields; the own checks judge them (#st-ticket-own-checks).

export type HeaderName = "title" | "cites" | "blocked_by" | "stories" | "touches";

export const HEADER_NAMES: readonly HeaderName[] = ["title", "cites", "blocked_by", "stories", "touches"];
export const SECTION_NAMES = ["What to build", "Acceptance criteria", "Checks"] as const;

/** One line of the file, with its 1-based line number. */
export type Line = { n: number; text: string };

export type Header = { line: number; value: string };

/** A `## ` heading and the lines below it, up to the next `## ` heading. */
export type Section = { name: string; line: number; lines: Line[] };

export type ParsedTicket = {
  lines: Line[];
  /** The first line of each header name above the first section heading. */
  headers: Partial<Record<HeaderName, Header>>;
  sections: Section[];
};

const HEADER = /^(title|cites|blocked_by|stories|touches):[ \t]*(.*?)\s*$/;
const HEADING = /^##[ \t]+(.+?)\s*$/;

export function parseTicket(text: string): ParsedTicket {
  const lines = text.split(/\r?\n/).map((line, i) => ({ n: i + 1, text: line }));
  const headers: Partial<Record<HeaderName, Header>> = {};
  const sections: Section[] = [];
  for (const line of lines) {
    const heading = HEADING.exec(line.text);
    if (heading !== null) {
      sections.push({ name: heading[1] as string, line: line.n, lines: [] });
      continue;
    }
    const section = sections.at(-1);
    if (section !== undefined) {
      section.lines.push(line);
      continue;
    }
    const header = HEADER.exec(line.text);
    if (header === null) continue;
    const name = header[1] as HeaderName;
    headers[name] ??= { line: line.n, value: header[2] as string };
  }
  return { lines, headers, sections };
}

/** The entries of a comma-separated header value, trimmed, without the empty ones. */
export function listOf(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

export function sectionOf(ticket: ParsedTicket, name: string): Section | undefined {
  return ticket.sections.find((section) => section.name === name);
}
