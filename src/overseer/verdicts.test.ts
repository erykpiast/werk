import { expect, test } from "bun:test";
import {
  askPrompt,
  loopPrompt,
  parseAskVerdict,
  parseLoopVerdict,
  resultText,
} from "./verdicts.ts";

test("an ask verdict reads allow and deny, with text around the object", () => {
  expect(
    parseAskVerdict('Sure. {"verdict":"Allow","comment":"fits"} done'),
  ).toEqual({
    allow: true,
    comment: "fits",
  });
  expect(parseAskVerdict('{"verdict":"deny","comment":"rm -rf"}')).toEqual({
    allow: false,
    comment: "rm -rf",
  });
});

test("a reply that does not read is no verdict", () => {
  for (const text of [
    null,
    "",
    "no json",
    "{bad}",
    "[1]",
    '{"verdict":"maybe"}',
    '{"x":1}',
  ]) {
    expect(parseAskVerdict(text)).toBeNull();
    expect(parseLoopVerdict(text)).toBeNull();
  }
});

test("a loop verdict reads looping and not looping", () => {
  expect(
    parseLoopVerdict('{"verdict":"looping","reason":"same test"}'),
  ).toEqual({
    looping: true,
    reason: "same test",
  });
  expect(parseLoopVerdict('{"verdict":"not looping"}')).toEqual({
    looping: false,
    reason: "",
  });
});

test("resultText takes the last result event", () => {
  const stream = [
    '{"type":"result","result":"old"}',
    "noise",
    '{"type":"assistant"}',
    '{"type":"result","result":"new"}',
  ].join("\n");
  expect(resultText(stream)).toBe("new");
  expect(resultText('{"type":"result"}')).toBeNull();
  expect(resultText("")).toBeNull();
});

test("the prompts carry the call, the ticket, the brief and the calls", () => {
  const ask = askPrompt(
    { tool: "Bash", input: { command: "ls" } },
    "the ticket",
  );
  expect(ask.split("\n")[0]).toContain("Tool: Bash");
  expect(ask).toContain("Bash ls");
  expect(ask).toContain("the ticket");
  const loop = loopPrompt("the brief", ["Bash make test", "Edit a.ts"]);
  expect(loop).toContain("the brief");
  expect(loop).toContain("- Bash make test\n- Edit a.ts");
});
