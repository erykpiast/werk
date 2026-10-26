import { mkdirSync, writeFileSync } from "node:fs";
import { decided, dependsOn, lines, ROOT, real } from "../e2e/g3-support.ts";

mkdirSync(`${import.meta.dirname}/p/.werk`, { recursive: true });
writeFileSync(
  `${import.meta.dirname}/p/.werk/log.jsonl`,
  lines([
    ...ROOT,
    ...real("x"),
    ...real("p", { status: "proto" }),
    ...decided("c"),
    ...real("g", { parent: "c" }),
    ...decided("y"),
    dependsOn("y", "x"),
    { type: "node.reopened", id: "x", at: "2026-10-10T09:00:00.000Z" },
  ]),
);
