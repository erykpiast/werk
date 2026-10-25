import { expect, test } from "bun:test";
import { recall, remember } from "./view-memory";

const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
};

test("a project that remembers nothing opens the map at the root", () => {
  expect(recall(memory(), "werk")).toEqual({ view: "map", card: null });
});

test("a view other than the map keeps the last map card", () => {
  const store = memory();
  remember(store, "werk", { view: "map", card: "checkout" });
  remember(store, "werk", { view: "board", card: null });
  expect(recall(store, "werk")).toEqual({ view: "board", card: "checkout" });
  remember(store, "werk", { view: "map", card: "checkout" });
  expect(recall(store, "werk")).toEqual({ view: "map", card: "checkout" });
});

test("each project keeps its own memory", () => {
  const store = memory();
  remember(store, "a", { view: "board", card: null });
  expect(recall(store, "b").view).toBe("map");
});

test("a damaged value falls back to the map at the root", () => {
  const store = memory();
  store.setItem("werk.view.werk", "{nope");
  expect(recall(store, "werk")).toEqual({ view: "map", card: null });
  store.setItem("werk.view.werk", "7");
  expect(recall(store, "werk")).toEqual({ view: "map", card: null });
});
