import { describe, expect, test } from "bun:test";
import { cardHref, codeSpanRef, linkRefs, refLabel, refLink } from "./reflink";

const known = new Set(["al-diff", "align", "pr-iface:opt0", "pr-iface", "a_b-c"]);
const mark = (id: string): string => `[${id}]`;

describe("linkRefs", () => {
  test("links a #id for any known id, a single word included", () => {
    expect(linkRefs("see #al-diff and #align.", known, mark)).toBe("see [al-diff] and [align].");
  });

  test("links a bare id only when it holds a hyphen or a colon", () => {
    expect(linkRefs("al-diff, pr-iface:opt0, align", known, mark)).toBe("[al-diff], [pr-iface:opt0], align");
  });

  test("leaves an unknown id as written", () => {
    expect(linkRefs("#nope and no-such-card", known, mark)).toBe("#nope and no-such-card");
  });

  test("links the whole token or none of it", () => {
    expect(linkRefs("pr-iface:opt9 foo-al-diff", known, mark)).toBe("pr-iface:opt9 foo-al-diff");
  });

  test("starts no reference after a hyphen, a #, a colon, a word character or a slash", () => {
    for (const text of ["--al-diff", "##al-diff", "x:al-diff", "x#al-diff", "a/#al-diff", "/map/al-diff"]) {
      expect(linkRefs(text, known, mark)).toBe(text);
    }
  });

  test("reads an escaped character as the character it stands for", () => {
    expect(linkRefs("&amp;al-diff", known, mark)).toBe("&amp;al-diff");
    expect(linkRefs("&#39;al-diff&#39;", known, mark)).toBe("&#39;[al-diff]&#39;");
    expect(linkRefs("&lt;al-diff&gt;", known, mark)).toBe("&lt;[al-diff]&gt;");
  });

  test("leaves a URL fragment alone", () => {
    expect(linkRefs("https://example.com/page#al-diff", known, mark)).toBe("https://example.com/page#al-diff");
  });
});

describe("codeSpanRef", () => {
  test("names the card when the span holds nothing but a known id", () => {
    expect(codeSpanRef("al-diff", known)).toBe("al-diff");
    expect(codeSpanRef("#al-diff", known)).toBe("al-diff");
    expect(codeSpanRef(" align ", known)).toBe("align");
  });

  test("names no card for a command or an unknown id", () => {
    expect(codeSpanRef("node src/cli.ts show #al-diff", known)).toBeUndefined();
    expect(codeSpanRef("nope", known)).toBeUndefined();
  });
});

describe("the rendered reference", () => {
  test("shows #id in a monospace face and points at the card's page", () => {
    expect(refLink("al-diff")).toBe('<a class="ref" href="/map/al-diff"><code>#al-diff</code></a>');
    expect(refLabel("al-diff")).toBe('<span class="ref"><code>#al-diff</code></span>');
  });

  test("encodes the id in the address", () => {
    expect(cardHref("pr-iface:opt0")).toBe("/map/pr-iface%3Aopt0");
  });
});
