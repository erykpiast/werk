import { expect, test } from "bun:test";
import { grammarFor, highlight } from "./highlight.ts";

test("each grammar answers to its usual tags in any letter case", () => {
  for (const tag of ["sh", "Shell", "ZSH", "bash"])
    expect(grammarFor(tag)).toBe("shell");
  for (const tag of ["tsx", "TypeScript", "js", "jsx"])
    expect(grammarFor(tag)).toBe("script");
  expect(grammarFor("jsonc")).toBe("json");
  expect(grammarFor("cobol")).toBeNull();
  expect(grammarFor("")).toBeNull();
});

test("a tag with no grammar gives escaped text with no colour", () => {
  expect(highlight("a < b", "cobol")).toBe("a &#60; b");
  expect(highlight("a < b", "")).toBe("a &#60; b");
});

test("json colours keys, strings, numbers, literals and comments", () => {
  const html = highlight('{"k": "v", "n": -1.5e3, "t": null} // c', "jsonc");
  expect(html).toContain('<span class="tok-key">&#34;k&#34;</span>');
  expect(html).toContain('<span class="tok-string">&#34;v&#34;</span>');
  expect(html).toContain('<span class="tok-number">-1.5e3</span>');
  expect(html).toContain('<span class="tok-literal">null</span>');
  expect(html).toContain('<span class="tok-comment">// c</span>');
});

test("script colours keywords, template strings and block comments, and leaves words alone", () => {
  const html = highlight("const mytype = `a{1}`; /* x */ true", "ts");
  expect(html).toContain('<span class="tok-keyword">const</span> mytype');
  expect(html).toContain('<span class="tok-string">`a{1}`</span>');
  expect(html).toContain('<span class="tok-comment">/* x */</span>');
  expect(html).toContain('<span class="tok-literal">true</span>');
});

test("shell colours variables, flags, keywords, strings and comments, but not a # inside a word", () => {
  const html = highlight(
    'if [ -f "$X" ]; then ls --all a#b; fi # done',
    "bash",
  );
  expect(html).toContain('<span class="tok-keyword">if</span>');
  expect(html).toContain('<span class="tok-flag">-f</span>');
  expect(html).toContain('<span class="tok-flag">--all</span>');
  expect(html).toContain('<span class="tok-string">&#34;$X&#34;</span>');
  expect(html).toContain('<span class="tok-comment"># done</span>');
  expect(html).toContain("a#b;");
});
