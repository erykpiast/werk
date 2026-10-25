import { expect, test } from "bun:test";
import { ownChecks } from "../tickets/own-checks.ts";
import { parseTicket } from "../tickets/ticket-parse.ts";
import {
  followupText,
  followupTitle,
  nextNumber,
  quotableGap,
} from "./followup-ticket.ts";
import type { GradeLine } from "./grade.ts";

const source = {
  id: "r/01",
  title: "Paste a screenshot",
  touches: "composer",
  checks: ["make test", "make lint"],
};
const gap = (card: string | undefined, text: string): GradeLine => ({
  id: card === undefined ? "scope" : `card-${card}`,
  kind: card === undefined ? "scope" : "contradiction",
  text: "t",
  ...(card === undefined ? {} : { card }),
  score: 2,
  gap: text,
  builds: true,
  person: false,
  failed: true,
});

test("the first free number from 1 to 99 is two digits, and none is left when all are taken", () => {
  expect(nextNumber(["01", "02", "04"])).toBe("03");
  expect(nextNumber([])).toBe("01");
  expect(
    nextNumber(Array.from({ length: 99 }, (_, i) => String(i + 1))),
  ).toBeNull();
});

test("the follow-up cites each gap's card once, quotes each gap, and checks as its source does", () => {
  const text = followupText(source, [
    gap("a", "an empty list is sent"),
    gap("a", "two\nlines"),
    gap(undefined, "an extra menu"),
  ]);
  const ticket = parseTicket("02.md", text);
  expect(ticket?.headers.title?.value).toBe(followupTitle(source));
  expect(ticket?.headers.cites?.value).toBe("a");
  expect(ticket?.headers.touches?.value).toBe("composer");
  expect(ticket?.headers.blocked_by?.value).toBe("");
  expect(text).toContain('#a: "an empty list is sent"');
  expect(text).toContain('#a: "two lines"');
  expect(text).toContain('scope: "an extra menu"');
  expect(text).toContain("## Checks\n\n- `make test`\n- `make lint`");
  expect(text).toContain("r/01");
});

test("a quoted gap loses its file paths and stays within the size limit, so the follow-up passes its own checks", () => {
  expect(quotableGap("see src/build/grade.ts:12 and (src/a/b.ts).", 500)).toBe(
    "see grade.ts:12 and (b.ts).",
  );
  expect(quotableGap("see https://x.com/a/b.js", 500)).toBe(
    "see https://x.com/a/b.js",
  );
  const gaps = Array.from({ length: 6 }, (_, i) =>
    gap(`c${i}`, `src/build/grade.ts:${i} ${"word ".repeat(400)}`),
  );
  const ticket = parseTicket("02.md", followupText(source, gaps));
  if (ticket === null) throw new Error("the follow-up did not parse");
  expect(ownChecks(ticket)).toEqual([]);
});
