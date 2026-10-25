import { expect, test } from "bun:test";
import {
  type Grade,
  gradeFailureText,
  isSmallGap,
  judgeGrade,
  type LineReply,
  parseGradeReply,
  settleGrade,
} from "./grade.ts";
import { lineSpecs } from "./grade-lines.ts";

const specs = lineSpecs(["c1"], [{ id: "a", title: "A" }]);
const reply = (lines: unknown[]) => JSON.stringify({ lines });
const given = (
  entries: Record<string, Partial<LineReply> & { score: number }>,
) =>
  new Map(
    Object.entries(entries).map(([id, e]): [string, LineReply] => [
      id,
      { gap: "", builds: false, person: false, regression: false, ...e },
    ]),
  );
const grade = (r: ReturnType<typeof given>, previous: Grade | null = null) =>
  settleGrade(specs, r, previous);

test("a reply parses into one entry per known line, the first entry winning", () => {
  const parsed = parseGradeReply(
    reply([
      { line: "criterion-1", score: 4 },
      { line: "criterion-1", score: 1, gap: "later entry" },
      { line: "elsewhere", score: 5 },
      { line: "card-a", score: 2, gap: "g", builds: true, person: false },
      "junk",
    ]),
    specs,
  );
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect([...parsed.lines.keys()]).toEqual(["criterion-1", "card-a"]);
  expect(parsed.lines.get("card-a")).toEqual({
    score: 2,
    gap: "g",
    builds: true,
    person: false,
    regression: false,
  });
});

test("a reply that is not the format, or has a bad score, or a failing line with no gap, is broken", () => {
  expect(parseGradeReply("no json", specs).ok).toBe(false);
  const bad = (entry: unknown) => parseGradeReply(reply([entry]), specs);
  expect(bad({ line: "scope", score: 6 }).ok).toBe(false);
  expect(bad({ line: "scope", score: 2.5, gap: "g" }).ok).toBe(false);
  expect(bad({ line: "scope", score: "4" }).ok).toBe(false);
  const noGap = bad({ line: "scope", score: 2, gap: "  " });
  expect(noGap.ok).toBe(false);
  if (!noGap.ok) expect(noGap.error).toContain("scope");
});

test("a line the reply leaves out scores 0 and fails", () => {
  const settled = grade(
    given({ "criterion-1": { score: 4 }, scope: { score: 5 } }),
  );
  const left = settled.lines.find((l) => l.id === "card-a");
  expect(left).toMatchObject({ score: 0, failed: true });
  expect(left?.gap).toContain("left this line out");
});

test("3 passes and 2 fails", () => {
  const settled = grade(
    given({
      "criterion-1": { score: 3 },
      "card-a": { score: 2, gap: "g" },
      scope: { score: 5 },
    }),
  );
  expect(settled.lines.map((l) => l.failed)).toEqual([false, true, false]);
});

const first = grade(
  given({
    "criterion-1": { score: 2, gap: "open gap" },
    "card-a": { score: 4 },
    scope: { score: 5 },
  }),
);

test("a later grade passes a line the first grade passed, even with a new gap there", () => {
  const second = grade(
    given({
      "criterion-1": { score: 4 },
      "card-a": { score: 2, gap: "new detail" },
      scope: { score: 5 },
    }),
    first,
  );
  expect(second.lines.find((l) => l.id === "card-a")).toMatchObject({
    failed: false,
    gap: "new detail",
  });
});

test("a later grade fails a passed line only for a regression", () => {
  const second = grade(
    given({
      "criterion-1": { score: 4 },
      "card-a": { score: 2, gap: "broken now", regression: true },
      scope: { score: 5 },
    }),
    first,
  );
  expect(second.lines.find((l) => l.id === "card-a")?.failed).toBe(true);
});

test("a later grade keeps a line failed while its gap is open", () => {
  const second = grade(
    given({
      "criterion-1": { score: 2, gap: "still open" },
      "card-a": { score: 4 },
      scope: { score: 5 },
    }),
    first,
  );
  expect(second.lines.find((l) => l.id === "criterion-1")?.failed).toBe(true);
});

test("a passed line that the later grade leaves out still scores 0", () => {
  const second = grade(
    given({ "criterion-1": { score: 4 }, scope: { score: 5 } }),
    first,
  );
  expect(second.lines.find((l) => l.id === "card-a")?.failed).toBe(true);
});

const small = (more: Partial<LineReply> = {}) =>
  grade(
    given({
      "criterion-1": { score: 4 },
      "card-a": { score: 2, gap: "small", builds: true, ...more },
      scope: { score: 5 },
    }),
  );

test("a small gap is a failed contradiction line one under a pass, on a built card, that no person must settle", () => {
  const line = (g: Grade) => g.lines.find((l) => l.id === "card-a");
  expect(isSmallGap(line(small()) as never)).toBe(true);
  expect(isSmallGap(line(small({ builds: false })) as never)).toBe(false);
  expect(isSmallGap(line(small({ person: true })) as never)).toBe(false);
  expect(isSmallGap(line(small({ score: 1 })) as never)).toBe(false);
  const delivery = grade(
    given({
      "criterion-1": { score: 2, gap: "g", builds: true },
      "card-a": { score: 4 },
      scope: { score: 5 },
    }),
  );
  expect(isSmallGap(delivery.lines[0] as never)).toBe(false);
});

test("a green grade has no failed line; a small gap defers only on the last counted pass", () => {
  const good = grade(
    given({
      "criterion-1": { score: 4 },
      "card-a": { score: 4 },
      scope: { score: 4 },
    }),
  );
  expect(judgeGrade(good, false)).toEqual({
    green: true,
    blocking: [],
    deferred: [],
  });
  expect(judgeGrade(small(), false).green).toBe(false);
  const last = judgeGrade(small(), true);
  expect(last.green).toBe(true);
  expect(last.deferred.map((l) => l.id)).toEqual(["card-a"]);
});

test("a small gap beside another failed line fails the last pass", () => {
  const mixed = grade(
    given({
      "criterion-1": { score: 2, gap: "unmet" },
      "card-a": { score: 2, gap: "small", builds: true },
      scope: { score: 5 },
    }),
  );
  const verdict = judgeGrade(mixed, true);
  expect(verdict.green).toBe(false);
  expect(verdict.blocking.map((l) => l.id)).toEqual(["criterion-1", "card-a"]);
});

test("the failure text names each failed line with its gap", () => {
  const text = gradeFailureText(small().lines.filter((l) => l.failed));
  expect(text).toContain("this line");
  expect(text).toContain("card-a (contradiction, score 2)");
  expect(text).toContain("gap: small");
  expect(gradeFailureText(first.lines.filter((l) => l.failed))).toContain(
    "open gap",
  );
  expect(gradeFailureText(grade(given({})).lines)).toContain("these lines");
});
