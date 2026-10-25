import { expect, test } from "bun:test";
import { foldBoard } from "./fold.ts";
import { resolveTicket } from "./resolve.ts";

const board = foldBoard(
  ["a/01", "a/02", "b/02"].map((id, i) => ({
    line: i + 1,
    event: { type: "ticket.planned", id },
  })),
);

test("a full id and a unique number name their ticket", () => {
  expect(resolveTicket(board, "b/02")).toEqual({ ok: true, id: "b/02" });
  expect(resolveTicket(board, "1")).toEqual({ ok: true, id: "a/01" });
  expect(resolveTicket(board, "01")).toEqual({ ok: true, id: "a/01" });
});

test("a number on no ticket, a number on two plans, and an unknown id are refused", () => {
  expect(resolveTicket(board, "09").ok).toBe(false);
  const two = resolveTicket(board, "02");
  expect(two.ok).toBe(false);
  expect(!two.ok && two.error).toContain("2 plans");
  expect(resolveTicket(board, "c/01").ok).toBe(false);
});
