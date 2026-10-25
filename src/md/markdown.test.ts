import { expect, test } from "bun:test";
import {
  renderInline,
  renderMarkdown,
  renderTile,
  renderTitle,
} from "./markdown.ts";

const known = (...ids: string[]) => {
  const set = new Set(ids);
  return (id: string) => set.has(id);
};
const k = known("al-diff", "align", "pr-iface:opt0");
const link = (id: string) =>
  `<a class="card-ref" href="/map/${encodeURIComponent(id)}">#${id}</a>`;

test("a bare id, a code span of only the id, and a hashed id all link with a # label", () => {
  expect(renderInline("al-diff", k)).toBe(link("al-diff"));
  expect(renderInline("`al-diff`", k)).toBe(link("al-diff"));
  expect(renderInline("`#al-diff`", k)).toBe(link("al-diff"));
  expect(renderInline("see #al-diff.", k)).toBe(`see ${link("al-diff")}.`);
  expect(renderInline("#align", k)).toBe(link("align"));
});

test("a bare id without a hyphen or colon stays text, and a colon id links", () => {
  expect(renderInline("align", k)).toBe("align");
  expect(renderInline("pr-iface:opt0", k)).toBe(link("pr-iface:opt0"));
  expect(renderInline("pr-iface:opt0", k)).toContain("%3A");
});

test("an id inside a longer token stays text", () => {
  for (const text of [
    "--al-diff",
    "##al-diff",
    "&al-diff",
    "a/#al-diff",
    "x#al-diff",
    "x:al-diff",
  ]) {
    expect(renderInline(text, k)).not.toContain("<a");
  }
});

test("an unknown id and a removed card stay plain text", () => {
  expect(renderInline("#gone and gone-card", k)).toBe("#gone and gone-card");
});

test("a code span with more than an id stays code", () => {
  expect(renderInline("`node cli.ts show #align`", k)).toBe(
    "<code>node cli.ts show #align</code>",
  );
  expect(renderInline("`**x** al-diff`", k)).toBe("<code>**x** al-diff</code>");
});

test("a tile shows a reference without a link", () => {
  expect(renderTile("#al-diff and `align`", k)).toBe(
    '<span class="card-ref">#al-diff</span> and <span class="card-ref">#align</span>',
  );
  expect(renderTile("[t](/x) **b**", k)).toBe("t <strong>b</strong>");
});

test("script in text is escaped", () => {
  const html = renderMarkdown(
    "<script>alert(1)</script> [x](javascript:alert(1))",
    k,
  );
  expect(html).not.toContain("<script");
  expect(html).not.toContain('href="javascript');
  expect(html).toContain("&#60;script&#62;");
});

test("inline marks and links render", () => {
  expect(renderInline("**b** *i* _j_ ~~s~~ [t](https://x.y/a?b=1)", k)).toBe(
    '<strong>b</strong> <em>i</em> <em>j</em> <del>s</del> <a href="https://x.y/a?b=1">t</a>',
  );
});

test("blocks: headings, lists, quotes, rules, paragraphs", () => {
  const html = renderMarkdown(
    "# Head\ntext one\ntext two\n\n- a\n- b\n\n1. x\n2. y\n\n> quote\n> more\n\n---\n#align",
    k,
  );
  expect(html).toContain("<h1>Head</h1>");
  expect(html).toContain("<p>text one\ntext two</p>");
  expect(html).toContain("<ul><li>a</li><li>b</li></ul>");
  expect(html).toContain("<ol><li>x</li><li>y</li></ol>");
  expect(html).toContain("<blockquote><p>quote\nmore</p></blockquote>");
  expect(html).toContain("<hr>");
  expect(html).toContain(link("align"));
});

test("a heading marker is not a reference", () => {
  expect(renderMarkdown("# align", k)).toBe("<h1>align</h1>");
});

test("a list item continues on an indented line", () => {
  expect(renderMarkdown("- a\n  b\n- c", k)).toBe(
    "<ul><li>a\nb</li><li>c</li></ul>",
  );
});

test("a fence tagged zsh is highlighted as shell, with its label", () => {
  const html = renderMarkdown("```zsh\necho $HOME # hi\n```", k);
  expect(html).toContain('<span class="code-tag">zsh</span>');
  expect(html).toContain('class="lang-shell"');
  expect(html).toContain('<span class="tok-variable">$HOME</span>');
  expect(html).toContain('<span class="tok-comment"># hi</span>');
});

test("a fence with an unknown tag renders plain and escaped, with its label", () => {
  const html = renderMarkdown("```cobol\nMOVE <A> TO B\n```", k);
  expect(html).toContain('<span class="code-tag">cobol</span>');
  expect(html).toContain("<pre><code>MOVE &#60;A&#62; TO B</code></pre>");
  expect(html).not.toContain("tok-");
});

test("a fence with no tag has no label, and refs and marks inside stay literal", () => {
  const html = renderMarkdown("```\n**x** #al-diff\n```", k);
  expect(html).not.toContain("code-tag");
  expect(html).toContain("**x** #al-diff");
  expect(html).not.toContain("<a");
});

test("a fence tag is matched in any letter case, and json and script grammars colour tokens", () => {
  expect(renderMarkdown('```JSON\n{"a": [1, true]}\n```', k)).toContain(
    '<span class="tok-key">&#34;a&#34;</span>',
  );
  const ts = renderMarkdown("```tsx\nconst a = 'x'; // c\n```", k);
  expect(ts).toContain('<span class="tok-keyword">const</span>');
  expect(ts).toContain('<span class="tok-string">&#39;x&#39;</span>');
  expect(ts).toContain('<span class="tok-comment">// c</span>');
});

test("an unclosed fence renders to the end of the text, and a tilde fence closes on its own marker", () => {
  expect(renderMarkdown("before\n```js\nlet a", k)).toContain("<pre><code");
  const html = renderMarkdown("~~~\n```\n~~~\nafter", k);
  expect(html).toContain("<pre><code>```</code></pre>");
  expect(html).toContain("<p>after</p>");
});

test("a title shows a backtick span as code and escapes the rest", () => {
  expect(renderTitle("Run `make <x>` now")).toBe(
    "Run <code>make &#60;x&#62;</code> now",
  );
});
