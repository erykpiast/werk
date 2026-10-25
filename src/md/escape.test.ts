import { expect, test } from "bun:test";
import { escapeHtml } from "./escape.ts";

test("the five markup characters become numeric entities", () => {
  expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
    "&#60;a href=&#34;x&#34;&#62;&#39;&#38;&#39;&#60;/a&#62;",
  );
});
