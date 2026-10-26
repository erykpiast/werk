// The werk command line. The start-up loads the verbs, starts the chosen one and does not wait
// for it; the callback exits with the verb's code (#werk-hmr-entry-settles, #werk-verb-registry).
import "./verbs/index.ts";
import { registry } from "./cli/registry.ts";
import { start } from "./cli/start.ts";

start(
  process.argv.slice(2),
  registry,
  { out: (text) => process.stdout.write(text), err: (text) => process.stderr.write(text) },
  (code) => process.exit(code),
);
