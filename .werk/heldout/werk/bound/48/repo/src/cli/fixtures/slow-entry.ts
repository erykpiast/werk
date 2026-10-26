// A start-up like the command line's, with one verb that ends after the start-up and exits 3.
// The output order shows that the start-up does not wait for the verb (#werk-hmr-entry-settles).
import { Registry } from "../registry.ts";
import { start } from "../start.ts";

const verbs = new Registry();
verbs.register({
  name: "slow",
  help: "End after a timer, with exit code 3.",
  run: async (_args, io) => {
    await Bun.sleep(20);
    io.out("verb ended\n");
    return 3;
  },
});
const io = { out: (text: string) => process.stdout.write(text), err: (text: string) => process.stderr.write(text) };
start(process.argv.slice(2), verbs, io, (code) => process.exit(code));
process.stdout.write("start-up ended\n");
