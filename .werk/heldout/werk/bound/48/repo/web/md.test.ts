import { describe, expect, test } from "bun:test";
import { renderMarkdown, renderTileInline } from "./md";

const known = new Set(["al-diff", "align"]);
const link = '<a class="ref" href="/map/al-diff"><code>#al-diff</code></a>';
const md = (text: string): string => renderMarkdown(text, known);

describe("card references", () => {
  test("renders #al-diff, bare al-diff and a code span holding al-diff as the same link", () => {
    expect(md("#al-diff")).toBe(`<p>${link}</p>`);
    expect(md("al-diff")).toBe(`<p>${link}</p>`);
    expect(md("`al-diff`")).toBe(`<p>${link}</p>`);
    expect(md("`#al-diff`")).toBe(`<p>${link}</p>`);
  });

  test("leaves a joined id and a command in a code span as text", () => {
    expect(md("--al-diff ##al-diff &al-diff")).toBe("<p>--al-diff ##al-diff &amp;al-diff</p>");
    expect(md("`node src/cli.ts show #al-diff`")).toBe("<p><code>node src/cli.ts show #al-diff</code></p>");
  });

  test("leaves an id the map does not know as plain text", () => {
    expect(md("see #gone-card and gone-card")).toBe("<p>see #gone-card and gone-card</p>");
  });

  test("links no reference inside a fenced block, a heading or a link's own label", () => {
    expect(md("```\nal-diff\n```")).toBe('<div class="codebox"><pre><code>al-diff</code></pre></div>');
    expect(md("## About #al-diff")).toBe("<h2>About #al-diff</h2>");
    expect(md("[al-diff](https://x.dev/#al-diff)")).toBe('<p><a href="https://x.dev/#al-diff">al-diff</a></p>');
  });

  test("renders a card id in a code span inside a link label as code, not as a second link", () => {
    expect(md("[see `al-diff`](/x)")).toBe('<p><a href="/x">see <code>al-diff</code></a></p>');
    expect(renderTileInline("[see `al-diff`](/x)", known)).toBe("see <code>al-diff</code>");
  });

  test("links every form of a reference in one body the same way, and leaves the prose between as text", () => {
    expect(md("See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too.")).toBe(
      `<p>See ${link}, then ${link}, then ${link}, then ${link}, and ` +
        '<a class="ref" href="/map/align"><code>#align</code></a> too.</p>',
    );
  });

  test("links a reference on its own in a body full of look-alikes, and none of the look-alikes", () => {
    const body = [
      "--al-diff",
      "##al-diff",
      "&al-diff",
      "a code span holding `node src/cli.ts show #al-diff`",
      "see #no-such-card",
      "visit https://example.com/page#al-diff",
      "",
      "# al-diff",
      "",
      "#al-diff",
    ].join("\n");
    expect(md(body)).toBe(
      [
        "<p>--al-diff<br>##al-diff<br>&amp;al-diff<br>a code span holding <code>node src/cli.ts show #al-diff</code>" +
          "<br>see #no-such-card<br>visit https://example.com/page#al-diff</p>",
        "<h1>al-diff</h1>",
        `<p>${link}</p>`,
      ].join("\n"),
    );
  });

  test("links a reference inside bold text", () => {
    expect(md("**#al-diff**")).toBe(`<p><strong>${link}</strong></p>`);
  });
});

describe("escaping", () => {
  test("escapes script tags in card text", () => {
    expect(md("<script>alert(1)</script>")).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
    expect(renderTileInline("<script>x</script>", known)).toBe("&lt;script&gt;x&lt;/script&gt;");
  });

  test("shows a script tag as text beside bold and struck-through words", () => {
    expect(md("Hello <script>window.__pwned = true</script> **bold** and ~~gone~~")).toBe(
      "<p>Hello &lt;script&gt;window.__pwned = true&lt;/script&gt; <strong>bold</strong> and <del>gone</del></p>",
    );
  });

  test("renders a link with an unsafe scheme as text", () => {
    expect(md("[x](javascript:alert(1))")).toBe("<p>[x](javascript:alert(1))</p>");
    expect(md("![x](javascript:alert)")).toBe("<p>![x](javascript:alert)</p>");
  });

  test("never expands a placeholder that the text itself holds", () => {
    expect(md("a \uE0000\uE001 b")).toBe("<p>a &#xE000;0&#xE001; b</p>");
    const attack = "![\uE0001\uE001](/nope) [y](/x/onerror=location='javascript:alert%281%29'//)";
    expect(md(attack)).toBe(
      '<p><img src="/nope" alt="&#xE000;1&#xE001;"> ' +
        '<a href="/x/onerror=location=&#39;javascript:alert%281%29&#39;//">y</a></p>',
    );
    expect(renderTileInline("\uE0000\uE001", known)).toBe("&#xE000;0&#xE001;");
  });
});

describe("blocks", () => {
  test("renders headings, rules, lists and quotes", () => {
    const text = "# One\n\n---\n- a\n- *b*\n\n3. c\n4. d\n\n1) e\n\n> quoted al-diff\n> - item\n\nline one\nline two";
    expect(md(text)).toBe(
      [
        "<h1>One</h1>",
        "<hr>",
        "<ul><li>a</li><li><em>b</em></li></ul>",
        '<ol start="3"><li>c</li><li>d</li></ol>',
        "<ol><li>e</li></ol>",
        `<blockquote><p>quoted ${link}</p>\n<ul><li>item</li></ul></blockquote>`,
        "<p>line one<br>line two</p>",
      ].join("\n"),
    );
  });

  test("renders empty text as nothing", () => {
    expect(md("")).toBe("");
  });
});

describe("a chat message", () => {
  test("links a known card and leaves a removed card, which the known set leaves out, as written", () => {
    expect(md("Compare #al-diff with #old-idea and show code")).toBe(
      `<p>Compare ${link} with #old-idea and show code</p>`,
    );
  });
});

describe("renderTileInline", () => {
  test("shows a summary's reference as #id with no link inside the tile", () => {
    expect(renderTileInline("Depends on #al-diff", known)).toBe(
      'Depends on <span class="ref"><code>#al-diff</code></span>',
    );
  });

  test("shows links and images as their text, and a reference as #id with no link", () => {
    expect(renderTileInline("see [the **doc**](https://x.dev) ![logo](/l.png)\nand al-diff `align`", known)).toBe(
      'see the <strong>doc</strong> logo and <span class="ref"><code>#al-diff</code></span> <span class="ref"><code>#align</code></span>',
    );
  });
});

describe("fenced blocks", () => {
  test("highlights by the tag and labels the box", () => {
    expect(md("```zsh\necho *hi*\n```")).toBe(
      '<div class="codebox"><span class="codebox-tag">zsh</span><pre><code data-grammar="shell"><span class="tok-kw">echo</span> *hi*</code></pre></div>',
    );
  });

  test("leaves a reference inside a fence of any tag as plain code", () => {
    for (const tag of ["", "zsh", "ts", "cobol"])
      expect(md(`\`\`\`${tag}\n#al-diff al-diff\n\`\`\``)).not.toContain("<a");
  });

  test("renders an unknown tag plain, with its label", () => {
    expect(md("```cobol\nMOVE A.\n```")).toBe(
      '<div class="codebox"><span class="codebox-tag">cobol</span><pre><code>MOVE A.</code></pre></div>',
    );
  });

  test("renders a fence with no closing line while text streams", () => {
    expect(md('Text\n```json\n{"a": 1')).toBe(
      '<p>Text</p>\n<div class="codebox"><span class="codebox-tag">json</span><pre><code data-grammar="json">{<span class="tok-key">&quot;a&quot;</span>: <span class="tok-num">1</span></code></pre></div>',
    );
  });

  test("boxes each fence of one body by its own tag: shell, script, an unknown tag and none", () => {
    const wide = "x".repeat(400);
    const html = md(
      ["```zsh", "echo $HOME | grep -v x", "```", "```TypeScript", "const n: number = 1", "```"]
        .concat(["```cobol", "DISPLAY 'HELLO'.", "```", "```", wide, "```"])
        .join("\n"),
    );
    expect(html.split("\n")).toEqual([
      '<div class="codebox"><span class="codebox-tag">zsh</span><pre><code data-grammar="shell">' +
        '<span class="tok-kw">echo</span> <span class="tok-var">$HOME</span> | grep <span class="tok-flag">-v</span> x</code></pre></div>',
      '<div class="codebox"><span class="codebox-tag">TypeScript</span><pre><code data-grammar="script">' +
        '<span class="tok-kw">const</span> n: number = <span class="tok-num">1</span></code></pre></div>',
      '<div class="codebox"><span class="codebox-tag">cobol</span><pre><code>DISPLAY &#39;HELLO&#39;.</code></pre></div>',
      `<div class="codebox"><pre><code>${wide}</code></pre></div>`,
    ]);
  });

  test("keeps the box and its label while a json fence streams, and colours the whole code once it closes", () => {
    const box = '<div class="codebox"><span class="codebox-tag">json</span><pre><code data-grammar="json">';
    const key = '<span class="tok-key">&quot;a&quot;</span>';
    expect(md('Here:\n```json\n{"a": [1')).toBe(
      `<p>Here:</p>\n${box}{${key}: [<span class="tok-num">1</span></code></pre></div>`,
    );
    expect(md('Here:\n```json\n{"a": [1, true]}\n```')).toBe(
      `<p>Here:</p>\n${box}{${key}: [<span class="tok-num">1</span>, <span class="tok-lit">true</span>]}</code></pre></div>`,
    );
  });

  test("keeps the prose on both sides of a fence", () => {
    expect(md("a\r\n```\nx\n```\nb")).toBe('<p>a</p>\n<div class="codebox"><pre><code>x</code></pre></div>\n<p>b</p>');
  });
});

describe("inline rules", () => {
  test("renders code, bold, italic and strikethrough", () => {
    expect(md("`a*b*` **b** __c__ *d* _e_ ~~f~~ *g*")).toBe(
      "<p><code>a*b*</code> <strong>b</strong> <strong>c</strong> <em>d</em> <em>e</em> <del>f</del> <em>g</em></p>",
    );
  });

  test("leaves an underscore inside a word alone", () => {
    expect(md("snake_case_name")).toBe("<p>snake_case_name</p>");
  });

  test("renders links and images", () => {
    expect(md("[a `b`](/map/x) ![pic](https://x.dev/p.png)")).toBe(
      '<p><a href="/map/x">a <code>b</code></a> <img src="https://x.dev/p.png" alt="pic"></p>',
    );
  });

  test("gives an image a plain-text alt, even when it holds code or a reference", () => {
    expect(md("![`x` and `al-diff`](/p.png)")).toBe('<p><img src="/p.png" alt="x and #al-diff"></p>');
  });

  test("leaves a link or image as text when its address holds code", () => {
    expect(md("[y](/`x`) ![z](/`al-diff`)")).toBe(`<p>[y](/<code>x</code>) ![z](/${link})</p>`);
  });
});
