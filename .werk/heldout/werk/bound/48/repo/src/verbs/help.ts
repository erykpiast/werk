// `werk help` prints every registered verb with its flags (#werk-cli, #werk-verb-registry).
import { formatHelp } from "../cli/help.ts";
import { registerVerb, registry } from "../cli/registry.ts";

registerVerb({
  name: "help",
  help: "Print every verb with its arguments and flags.",
  run: (_args, io) => {
    io.out(formatHelp(registry.list()));
    return 0;
  },
});
