// Detail for step 15: what the card-text renderer gives, outside any map page.
import { expect, test } from "bun:test";
import { renderMarkdown, renderTileInline } from "../web/md.ts";

const K = new Set(["al-diff", "align", "notes-test", "guards", "code-sample", "unsafe", "tile-card"]);

test("15 renderer", () => {
  const a = renderMarkdown("See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too.", K);
  console.log(a);
  expect(a.match(/href="\/map\/al-diff"/g)?.length).toBe(4);
  const u = renderMarkdown("Hello <script>window.__pwned = true</script> **bold** and ~~gone~~", K);
  console.log(u);
  expect(u).not.toContain("<script>");
  const s = renderMarkdown("Here:\n```json\n{\"a\": 1", K);
  console.log(s);
  expect(s).toContain("codebox-tag\">json");
  const t = renderTileInline("Depends on #al-diff", K);
  console.log(t);
  expect(t).not.toContain("<a");
});
