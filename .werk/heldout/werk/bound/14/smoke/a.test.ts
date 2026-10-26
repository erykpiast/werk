import { expect, test } from "bun:test";
import { freshProject } from "../../src/test/project.ts";
test("smoke", async () => { const p = freshProject(); const r = await p.werk(["show"]); console.log(r); expect(1).toBe(1); });
