import { expect, test } from "bun:test";
import { isDeadSession, isFatal, onCrash } from "./crash-rules.ts";

const fresh = { hasSession: true, retried: false };

test("only Claude Code's no-conversation message names a dead session", () => {
  expect(isDeadSession("No conversation found with session ID: abc")).toBe(
    true,
  );
  expect(isDeadSession("the agent exited with code 1")).toBe(false);
});

test("a dead session replays the waiting message while an id is stored", () => {
  const text = "No conversation found with session ID: abc";
  expect(onCrash(text, fresh)).toEqual({ kind: "replay" });
  expect(onCrash(text, { hasSession: false, retried: false })).toEqual({
    kind: "retry",
  });
});

test("a login error or a bad flag is reported whole and never retried", () => {
  const login =
    "Invalid credential.\nRemove the credential and run: claude auth login";
  const flag =
    "error: option '--permission-mode <mode>' argument 'x' is invalid. Allowed choices are auto, plan.";
  expect(isFatal(login)).toBe(true);
  expect(isFatal(flag)).toBe(true);
  expect(onCrash(login, fresh)).toEqual({
    kind: "report",
    message: `${login}\n\nYour message was not delivered. Send it again.`,
  });
});

test("any other crash retries once, then says the message was not delivered", () => {
  expect(onCrash("boom", fresh)).toEqual({ kind: "retry" });
  expect(onCrash("boom", { hasSession: true, retried: true })).toEqual({
    kind: "report",
    message: "boom\n\nYour message was not delivered. Send it again.",
  });
});
