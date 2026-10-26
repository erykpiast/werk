// A verb that only a test registers: it shows that a new verb module joins the help without
// a change to any other verb (#werk-verb-registry).
import { registerVerb } from "../registry.ts";

registerVerb({
  name: "echo",
  help: "Print the card id and the title back.",
  positionals: [{ name: "id", value: "id" }],
  flags: [{ name: "title", value: "text", help: "The title to print." }],
  run: (args, io) => {
    io.out(`${args.positionals[0]} ${args.flags.title ?? ""}\n`);
    return 0;
  },
});
