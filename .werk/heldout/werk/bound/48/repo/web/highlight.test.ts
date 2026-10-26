import { describe, expect, test } from "bun:test";
import { codeBlock, grammarFor, highlight } from "./highlight";

describe("grammarFor", () => {
  test("answers to the common names of each language, in any letter case", () => {
    for (const tag of ["sh", "shell", "zsh", "bash", "ZSH", "Bash"]) expect(grammarFor(tag)).toBe("shell");
    for (const tag of ["ts", "tsx", "typescript", "js", "TypeScript", "JS"]) expect(grammarFor(tag)).toBe("script");
    for (const tag of ["json", "jsonc", "JSONC"]) expect(grammarFor(tag)).toBe("json");
  });

  test("knows no grammar for an unknown or empty tag", () => {
    expect(grammarFor("cobol")).toBeUndefined();
    expect(grammarFor("")).toBeUndefined();
  });
});

describe("highlight", () => {
  test("colours shell keywords, strings, variables, flags and comments", () => {
    const html = highlight(`if [ "$HOME" ]; then ls --all $x # list\nfi`, "zsh");
    expect(html).toContain('<span class="tok-kw">if</span>');
    expect(html).toContain('<span class="tok-str">&quot;$HOME&quot;</span>');
    expect(html).toContain('<span class="tok-flag">--all</span>');
    expect(html).toContain('<span class="tok-var">$x</span>');
    expect(html).toContain('<span class="tok-com"># list</span>');
    expect(html).toContain('<span class="tok-kw">fi</span>');
  });

  test("does not read a # inside a shell word as a comment", () => {
    expect(highlight("echo a#b", "sh")).not.toContain("tok-com");
    expect(highlight("echo 'it'", "bash")).toContain('<span class="tok-str">&#39;it&#39;</span>');
  });

  test("colours script keywords, literals, numbers, strings and comments", () => {
    const html = highlight("const x = 42; // n\nif (y === null) return `a`; /* b */ 'c'", "tsx");
    expect(html).toContain('<span class="tok-kw">const</span>');
    expect(html).toContain('<span class="tok-num">42</span>');
    expect(html).toContain('<span class="tok-com">// n</span>');
    expect(html).toContain('<span class="tok-lit">null</span>');
    expect(html).toContain('<span class="tok-str">`a`</span>');
    expect(html).toContain('<span class="tok-com">/* b */</span>');
    expect(html).toContain('<span class="tok-str">&#39;c&#39;</span>');
  });

  test("leaves a keyword or a number inside a longer name uncoloured", () => {
    expect(highlight("format x1", "ts")).toBe("format x1");
  });

  test("tells a JSON key from a string value", () => {
    const html = highlight('{"a": "b", "n": -1.5, "t": true} // c', "jsonc");
    expect(html).toContain('<span class="tok-key">&quot;a&quot;</span>');
    expect(html).toContain('<span class="tok-str">&quot;b&quot;</span>');
    expect(html).toContain('<span class="tok-num">-1.5</span>');
    expect(html).toContain('<span class="tok-lit">true</span>');
    expect(html).toContain('<span class="tok-com">// c</span>');
  });

  test("renders an unknown tag as plain escaped text", () => {
    expect(highlight("<script>if</script>", "cobol")).toBe("&lt;script&gt;if&lt;/script&gt;");
  });
});

describe("codeBlock", () => {
  test("boxes the code with the tag as a corner label and the grammar it picked", () => {
    expect(codeBlock("ls", "zsh")).toBe(
      '<div class="codebox"><span class="codebox-tag">zsh</span><pre><code data-grammar="shell">ls</code></pre></div>',
    );
  });

  test("labels an unknown tag and renders its code plain", () => {
    expect(codeBlock("MOVE A TO B.", "cobol")).toBe(
      '<div class="codebox"><span class="codebox-tag">cobol</span><pre><code>MOVE A TO B.</code></pre></div>',
    );
  });

  test("shows no label for a fence with no tag", () => {
    expect(codeBlock("x < y", "")).toBe('<div class="codebox"><pre><code>x &lt; y</code></pre></div>');
  });
});
