// A scripted chat agent that repeats the text of each message it receives (held-out test double).
import { createInterface } from "node:readline";
import { writeSync } from "node:fs";
const print = (event: unknown) => writeSync(1, `${JSON.stringify(event)}\n`);
let n = 0;
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  let data: any;
  try {
    data = JSON.parse(line);
  } catch {
    return;
  }
  if (data?.type !== "user") return;
  n += 1;
  const text: string = data.message?.content?.[0]?.text ?? "";
  const id = `echo-${n}`;
  print({ type: "system", subtype: "init", session_id: "echo-session" });
  print({ type: "stream_event", event: { type: "message_start", message: { id } } });
  print({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text } } });
  print({ type: "assistant", message: { id, content: [{ type: "text", text }] } });
  print({ type: "result", subtype: "success", is_error: false, result: "", denied_requests: [] });
});
lines.on("close", () => process.exit(0));
