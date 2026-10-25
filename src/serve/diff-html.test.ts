import { expect, test } from "bun:test";
import type { CheckedOp } from "../map/edit-diff.ts";
import { diffBody, diffInline } from "./diff-html.ts";

const known = () => false;
const plain = (text: string) => text;

test("inline: added words are highlighted, removed words are highlighted and struck, shared words stay plain", () => {
  expect(diffInline("a b c", "a x c", plain)).toBe(
    'a <del class="diff-del">b</del> <ins class="diff-add">x</ins> c',
  );
});

test("a kept block shows plain, with no marks", () => {
  const ops: CheckedOp[] = [{ tag: "elaborated", old: "Same.", new: "Same." }];
  expect(diffBody(ops, known)).not.toContain("diff-");
});

test("a reworded paragraph is marked word by word, with no before and after sections", () => {
  const html = diffBody(
    [{ tag: "elaborated", old: "one two", new: "one three" }],
    known,
  );
  expect(html).toBe(
    '<p>one <del class="diff-del">two</del> <ins class="diff-add">three</ins></p>',
  );
});

test("a new block is added and a removed block is struck", () => {
  const html = diffBody(
    [
      { tag: "new", new: "Fresh." },
      { tag: "removed", old: "Gone.", real: true },
      { tag: "removed", old: "Ghost.", real: false },
    ],
    known,
  );
  expect(html).toContain(
    '<ins class="diff-add diff-block"><p>Fresh.</p></ins>',
  );
  expect(html).toContain('<del class="diff-del diff-block"><p>Gone.</p></del>');
  expect(html).toContain("not a block of the body");
});

test("a list pairs its items: a reworded item is marked alone and the others stay plain", () => {
  const html = diffBody(
    [
      {
        tag: "elaborated",
        old: "- keep\n- old word\n- tail",
        new: "- keep\n- new word\n- tail",
      },
    ],
    known,
  );
  expect(html).toBe(
    '<ul><li>keep</li><li><del class="diff-del">old</del> <ins class="diff-add">new</ins> word</li><li>tail</li></ul>',
  );
});

test("one added bullet marks only that bullet", () => {
  const html = diffBody(
    [{ tag: "elaborated", old: "- a\n- b", new: "- a\n- b\n- c" }],
    known,
  );
  expect(html).toBe(
    '<ul><li>a</li><li>b</li><li><ins class="diff-add">c</ins></li></ul>',
  );
});

test("one removed bullet marks only that bullet, and an ordered list stays ordered", () => {
  const html = diffBody(
    [{ tag: "elaborated", old: "1. a\n2. b\n3. c", new: "1. a\n2. c" }],
    known,
  );
  expect(html).toBe(
    '<ol><li>a</li><li><del class="diff-del">b</del></li><li>c</li></ol>',
  );
});

test("a continuation line joins the item above", () => {
  const html = diffBody(
    [{ tag: "elaborated", old: "- a\n  more", new: "- a more" }],
    known,
  );
  expect(html).toBe("<ul><li>a more</li></ul>");
});

test("a paragraph that becomes a list shows the old block removed and the new block added", () => {
  const html = diffBody(
    [{ tag: "elaborated", old: "Plain text.", new: "- one\n- two" }],
    known,
  );
  expect(html).toContain('<del class="diff-del diff-block"><p>Plain text.</p>');
  expect(html).toContain('<ins class="diff-add diff-block"><ul>');
});

test("a heading is marked inside at the new level, and code is replaced whole", () => {
  expect(
    diffBody([{ tag: "elaborated", old: "# A b", new: "## A c" }], known),
  ).toBe(
    '<h2>A <del class="diff-del">b</del> <ins class="diff-add">c</ins></h2>',
  );
  const code = diffBody(
    [{ tag: "elaborated", old: "```\nx\n```", new: "```\ny\n```" }],
    known,
  );
  expect(code).toContain("diff-del diff-block");
  expect(code).toContain("diff-add diff-block");
});
