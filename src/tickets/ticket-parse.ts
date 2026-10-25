/** Reads one ticket file into its header lines and sections (#st-ticket-shape). Pure. */

export const HEADER_FIELDS = [
  "title",
  "cites",
  "blocked_by",
  "stories",
  "touches",
] as const;
export type HeaderField = (typeof HEADER_FIELDS)[number];

export const SECTION_HEADINGS = [
  "What to build",
  "Acceptance criteria",
  "Checks",
] as const;

export type Section = {
  heading: string;
  /** The 1-based line of the heading. */
  line: number;
  /** The lines under the heading, up to the next heading, with their 1-based numbers. */
  body: { line: number; text: string }[];
};

export type Ticket = {
  file: string;
  text: string;
  lines: string[];
  /** The 1-based line of each header line that is present, and its text after the colon. */
  headers: Partial<Record<HeaderField, { line: number; value: string }>>;
  /** The 1-based line of a `files:` header line, which no ticket may have. */
  filesLine: number | null;
  sections: Section[];
};

const HEADER = /^(title|cites|blocked_by|stories|touches|files):[ \t]*(.*)$/;
const HEADING = /^##[ \t]+(.*?)[ \t]*$/;

/** A file with no title line is not a ticket: it gets null and no other check runs on it. */
export function parseTicket(file: string, text: string): Ticket | null {
  const lines = text.split("\n");
  const ticket: Ticket = {
    file,
    text,
    lines,
    headers: {},
    filesLine: null,
    sections: [],
  };
  let current: Section | null = null;
  lines.forEach((raw, index) => {
    const line = index + 1;
    const heading = HEADING.exec(raw);
    if (heading) {
      current = { heading: heading[1] as string, line, body: [] };
      ticket.sections.push(current);
      return;
    }
    if (current) {
      current.body.push({ line, text: raw });
      return;
    }
    const header = HEADER.exec(raw);
    if (!header) return;
    const name = header[1] as string;
    if (name === "files") {
      ticket.filesLine ??= line;
    } else if (!(name in ticket.headers)) {
      ticket.headers[name as HeaderField] = {
        line,
        value: (header[2] as string).trim(),
      };
    }
  });
  return ticket.headers.title ? ticket : null;
}

/** The first section with this heading. */
export function sectionOf(
  ticket: Ticket,
  heading: string,
): Section | undefined {
  return ticket.sections.find((section) => section.heading === heading);
}

/** The items of a comma-separated header value. An empty value has none. */
export function listOf(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

/** A number as written in blocked_by or stories: leading zeros drop, other text stays. */
export function normalizeNumber(item: string): string {
  return /^\d+$/.test(item) ? String(Number(item)) : item;
}

/** The ticket number from a file name: its leading digits, zeros dropped (#st-ticket-shape-number-from-file-name). */
export function ticketNumber(file: string): string | null {
  const digits = /^\d+/.exec(file);
  return digits ? String(Number(digits[0])) : null;
}
