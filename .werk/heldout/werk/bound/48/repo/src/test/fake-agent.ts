// The fake agent. The test run puts it first on the program search list under the real agent's
// name, so every process a test starts finds it (#werk-test-env). It replays the script of its
// temporary project (#werk-v0-seams-fake-script) and records each launch (#werk-test-fake-launch-log).
//
// It finds its project's folder in FAKE_AGENT_DIR: the script is script.json there, and the record
// is launches.jsonl beside it. Its role comes from WERK_ROLE (#st-build-seam-role-env).
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync, writeSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import {
  askEvent,
  CHAT_ROLE,
  FAKE_DIR_VAR,
  hasInputChannel,
  insideProject,
  LAUNCHES_FILE,
  type LaunchEntry,
  PAUSE_MARGIN_MS,
  parseInput,
  parseScript,
  pickReply,
  type Reply,
  ROLE_VAR,
  resultEvent,
  SCRIPT_FILE,
  type Script,
} from "./fake-script.ts";

const args = process.argv.slice(2);
const role = process.env[ROLE_VAR] ?? "";
const dir = process.env[FAKE_DIR_VAR];

function fail(message: string): never {
  process.stderr.write(`fake agent: ${message}\n`);
  process.exit(1);
}

// Written straight to the descriptor, so a crash right after a line still leaves the line printed.
const print = (event: unknown) => writeSync(1, `${JSON.stringify(event)}\n`);

if (dir === undefined || !existsSync(join(dir, SCRIPT_FILE)))
  fail(`no script installed${dir === undefined ? `: ${FAKE_DIR_VAR} is not set` : ` in ${dir}`}`);

const launches = join(dir, LAUNCHES_FILE);
const record = (entry: LaunchEntry) => appendFileSync(launches, `${JSON.stringify(entry)}\n`);

let script: Script;
try {
  script = parseScript(readFileSync(join(dir, SCRIPT_FILE), "utf8"));
} catch (error) {
  fail(`the script cannot be read: ${error instanceof Error ? error.message : String(error)}`);
}

/** How many earlier launches had this role: the next launch of a role plays the next reply. */
function earlierLaunches(): number {
  if (!existsSync(launches)) return 0;
  return readFileSync(launches, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as LaunchEntry)
    .filter((entry) => entry.kind === "launch" && entry.role === role).length;
}

const launchIndex = earlierLaunches();
record({ kind: "launch", pid: process.pid, args, role });

// The project of an edit is the folder the agent was started in, the way a real agent edits it.
const root = realpathSync(process.cwd());

/** Write a file inside the project, or exit with an error and write nothing (#werk-test-fake-edit-inside). */
function edit(path: string, content: string): void {
  const target = resolve(root, path);
  if (!insideProject(root, path)) fail(`the edit ${path} leads outside the project`);
  // A link inside the project can still lead out of it, so the nearest folder that exists is read too.
  let existing = dirname(target);
  while (!existsSync(existing)) existing = dirname(existing);
  if (!insideProject(root, join(relative(root, realpathSync(existing)), "x")))
    fail(`the edit ${path} leads outside the project`);
  if (existsSync(target) && !insideProject(root, relative(root, realpathSync(target))))
    fail(`the edit ${path} leads outside the project`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

// The asks of the current turn: each one waits for its answer from the input.
const open = new Set<string>();
// Counted over the whole launch, so an ask of a later turn never takes the id of an earlier one.
let asks = 0;
let inputClosed = !hasInputChannel(args);
const messages: unknown[] = [];
let wakeReader: (() => void) | undefined;

if (hasInputChannel(args)) {
  const lines = createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    const input = parseInput(line);
    if (input.kind === "answer") {
      open.delete(input.requestId);
    } else if (input.kind === "message") {
      record({ kind: "message", pid: process.pid, message: input.message });
      messages.push(input.message);
    }
    wakeReader?.();
  });
  lines.on("close", () => {
    inputClosed = true;
    wakeReader?.();
  });
}

/** The next message, or undefined once the input is closed and every message is read. */
async function nextMessage(): Promise<unknown> {
  while (messages.length === 0 && !inputClosed) await new Promise<void>((wake) => (wakeReader = wake));
  wakeReader = undefined;
  return messages.shift();
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Play one reply. Its open asks wait only before the final result; an unanswered ask is denied. */
async function play(reply: Reply): Promise<void> {
  for (const step of reply) {
    if ("event" in step) print(step.event);
    else if ("edit" in step) edit(step.edit.path, step.edit.content);
    else if ("pause" in step) await sleep(step.pause + PAUSE_MARGIN_MS);
    else if ("crash" in step) process.exit(step.crash);
    else {
      asks += 1;
      const id = step.ask.id ?? `ask-${process.pid}-${asks}`;
      open.add(id);
      print(askEvent(id, step.ask.tool, step.ask.input));
    }
  }
  while (open.size > 0 && !inputClosed) await new Promise<void>((wake) => (wakeReader = wake));
  const denied = [...open.keys()];
  open.clear();
  print(resultEvent(denied));
}

const own = script.roles[role];
if (role === CHAT_ROLE) {
  if (!hasInputChannel(args)) fail("a chat agent reads its messages from an input stream");
  for (let turn = 0; ; turn += 1) {
    if ((await nextMessage()) === undefined) break;
    const picked = pickReply(script, role, turn);
    if ("error" in picked) fail(picked.error);
    await play(picked.reply);
  }
  process.exit(own?.exit ?? 0);
} else {
  const picked = pickReply(script, role, launchIndex);
  if ("error" in picked) fail(picked.error);
  if (hasInputChannel(args)) await nextMessage();
  else record({ kind: "message", pid: process.pid, message: args.at(-1) ?? "" });
  await play(picked.reply);
  process.exit(own?.exit ?? 0);
}
