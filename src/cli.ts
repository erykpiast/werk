// The command line. See #werk-cli. The start-up loads the verbs and starts the chosen verb.
// It does not wait for the verb: a callback exits with its code (#werk-hmr-entry-settles).

import { loadVerbs } from "./cli/load.ts";
import { main } from "./cli/main.ts";
import { registry } from "./cli/registry.ts";

const io = {
  cwd: process.cwd(),
  env: process.env,
  out: (text: string) => console.log(text),
  err: (text: string) => console.error(text),
};

void loadVerbs()
  .then(() => main(process.argv.slice(2), registry, io))
  .then(
    (code) => process.exit(code),
    (error) => {
      console.error(
        `werk: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(1);
    },
  );
