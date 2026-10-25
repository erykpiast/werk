import { expect, test } from "bun:test";
import { checksumLine, clientAddress, entrySource } from "./entry-source.ts";

const paths = {
  clientDir: "/repo/dist/client",
  verbsDir: "/repo/src/verbs",
  ownModule: "/repo/src/own/own.ts",
  cliModule: "/repo/src/cli.ts",
};
const list = {
  client: ["index.html", "assets/app-1.js"],
  verbs: ["add.ts", "show.ts"],
  subagents: ["test-scope.md"],
};

test("the entry embeds each client file at its page address", () => {
  const source = entrySource(list, paths);
  expect(source).toContain(
    'import client1 from "/repo/dist/client/assets/app-1.js" with { type: "file" };',
  );
  expect(source).toContain('"/assets/app-1.js": client1,');
  expect(source).toContain('"/index.html": client0,');
});

test("the entry registers every verb module before it starts the command line", () => {
  const source = entrySource(list, paths);
  expect(source).toContain(
    '{ name: "show.ts", load: () => import("/repo/src/verbs/show.ts") },',
  );
  expect(source.indexOf("registerOwnFiles({")).toBeLessThan(
    source.indexOf('await import("/repo/src/cli.ts")'),
  );
});

test("a path with a quote or a space stays one string", () => {
  const source = entrySource(
    { client: ['a "b".js'], verbs: [], subagents: [] },
    paths,
  );
  expect(source).toContain('"/repo/dist/client/a \\"b\\".js"');
});

test("a client address starts with a slash", () => {
  expect(clientAddress("assets/x.css")).toBe("/assets/x.css");
});

test("a checksum line has the digest, two spaces, the file name and a newline", () => {
  expect(checksumLine("abc123", "werk-linux-x64")).toBe(
    "abc123  werk-linux-x64\n",
  );
});
