import { describe, expect, test } from "bun:test";
import { entityCharAtEnd, escapeHtml } from "./escape";

describe("escapeHtml", () => {
  test("escapes every character that can open markup or an attribute", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });
});

describe("entityCharAtEnd", () => {
  test("names the character an entity at the end stands for", () => {
    expect(entityCharAtEnd("a &amp;")).toBe("&");
    expect(entityCharAtEnd("&#39;")).toBe("'");
  });

  test("names nothing when no entity ends the text", () => {
    expect(entityCharAtEnd("a;")).toBeUndefined();
    expect(entityCharAtEnd("")).toBeUndefined();
  });
});
