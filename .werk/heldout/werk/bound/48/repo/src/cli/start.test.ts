import { expect, test } from "bun:test";
import { Registry, type Verb } from "./registry.ts";
import { runVerb, start, USAGE_ERROR } from "./start.ts";

function capture() {
  const io = {
    stdout: "",
    stderr: "",
    out: (t: string) => {
      io.stdout += t;
    },
    err: (t: string) => {
      io.stderr += t;
    },
  };
  return io;
}

function registryOf(...verbs: Verb[]): Registry {
  const registry = new Registry();
  for (const verb of verbs) registry.register(verb);
  return registry;
}

const show: Verb = {
  name: "show",
  help: "Print one card.",
  positionals: [{ name: "id", value: "id" }],
  run: (args, io) => {
    io.out(`card ${args.positionals[0]}\n`);
    return 0;
  },
};

test("the chosen verb gets its parsed arguments and its exit code is returned", async () => {
  const io = capture();
  expect(await runVerb(["show", "#auth"], registryOf(show), io)).toBe(0);
  expect(io.stdout).toBe("card auth\n");
});

test("an unknown verb prints the help and exits 2", async () => {
  const io = capture();
  expect(await runVerb(["nope"], registryOf(show), io)).toBe(USAGE_ERROR);
  expect(USAGE_ERROR).toBe(2);
  expect(io.stderr).toStartWith("werk: unknown verb nope\n");
  expect(io.stderr).toContain("  show <id>");
});

test("no verb prints the help and exits 2", async () => {
  const io = capture();
  expect(await runVerb([], registryOf(show), io)).toBe(2);
  expect(io.stderr).toStartWith("Usage: werk");
});

test("a wrong argument names the verb and exits 2", async () => {
  const io = capture();
  expect(await runVerb(["show"], registryOf(show), io)).toBe(2);
  expect(io.stderr).toStartWith("werk show: show needs <id>\n");
});

test("a verb that throws exits 1 with its message", async () => {
  const io = capture();
  const boom: Verb = {
    name: "boom",
    help: "Fail.",
    run: () => {
      throw new Error("no log here");
    },
  };
  const odd: Verb = { name: "odd", help: "Fail oddly.", run: () => Promise.reject("odd") };
  expect(await runVerb(["boom"], registryOf(boom, odd), io)).toBe(1);
  expect(await runVerb(["odd"], registryOf(boom, odd), io)).toBe(1);
  expect(io.stderr).toBe("werk boom: no log here\nwerk odd: odd\n");
});

test("the start-up returns before the verb ends, then exits with the verb's code", async () => {
  const { promise: gate, resolve: open } = Promise.withResolvers<void>();
  const slow: Verb = {
    name: "slow",
    help: "Wait for the gate.",
    run: async () => {
      await gate;
      return 7;
    },
  };
  const codes: number[] = [];
  const { promise: exited, resolve: onExit } = Promise.withResolvers<void>();
  start(["slow"], registryOf(slow), capture(), (code) => {
    codes.push(code);
    onExit();
  });
  await Bun.sleep(5);
  expect(codes).toEqual([]);
  open();
  await exited;
  expect(codes).toEqual([7]);
});

test("a second verb module joins the help without a change to any other verb", async () => {
  const { registry } = await import("./registry.ts");
  await import("../verbs/index.ts");
  const before = registry.list().map((verb) => verb.name);
  expect(before).not.toContain("echo");
  await import("./fixtures/echo-verb.ts");
  const io = capture();
  expect(await runVerb(["help"], registry, io)).toBe(0);
  expect(io.stdout).toContain(
    "  echo <id>\n      Print the card id and the title back.\n      --title <text>  The title to print.",
  );
  for (const name of before) expect(io.stdout).toContain(`  ${name}`);
  expect(await runVerb(["echo", "#auth", "--title", "#auth wins"], registry, io)).toBe(0);
  expect(io.stdout).toEndWith("auth #auth wins\n");
});
