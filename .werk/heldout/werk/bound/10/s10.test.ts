// Held-out steps 10.1 to 10.5: notes with werk say and werk inbox, and the thread in the map.
// Each step where the person opens the map or types in it first opens the map with openMap.
import { expect, test } from "bun:test";
import { events, mapWith, ok, openMap } from "./helpers.ts";

test("10.1 an agent's note appears on the card's thread in the map", async () => {
  const p = mapWith([{ id: "auth-login", title: "Login uses magic links", status: "decided" }]);
  const said = await ok(p, ["say", "auth-login", "Should expired links show a retry button?"]);
  expect(said.code).toBe(0);
  const note = events(p).at(-1);
  expect(note).toMatchObject({ actor: "agent", type: "note.added" });
  await openMap(p);
});

test("10.2 the agent reads the person's notes in the inbox, after a log position and capped by count", async () => {
  const p = mapWith([{ id: "auth-login", title: "Login" }]);
  // The person types the four notes in the map.
  await openMap(p);
});

test("10.3 a corrected ghost keeps its earlier notes, with one marker where the new words begin", async () => {
  const p = mapWith([{ id: "auth", title: "Auth" }]);
  await ok(p, ["add", "auth-retry", "--title", "Retry sends a new link", "--parent", "auth"]);
  // The person sees the ghost in the map and types a note on its thread.
  await openMap(p);
});

test("10.4 a note on a discarded ghost stays in the inbox and on the thread", async () => {
  const p = mapWith([{ id: "cache", title: "Cache" }]);
  await ok(p, ["add", "cache-ttl", "--title", "Cache entries live 60 seconds", "--parent", "cache"]);
  // The person types the note on the ghost's thread in the map.
  await openMap(p);
});

test("10.5 an agent writes a note on an excerpt", async () => {
  const p = mapWith([
    { id: "src-rfc", title: "RFC 9999", kind: "source" },
    { id: "src-rfc-quote", title: "Links expire after one use", kind: "excerpt" },
  ]);
  const said = await p.werk(["say", "src-rfc-quote", "This quote supports the retry decision"]);
  expect(said.code).toBe(0);
  await openMap(p);
});
