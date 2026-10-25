import { registerVerb, registry } from "../cli/registry.ts";

registerVerb({
  name: "help",
  summary: "List every verb",
  run: ({ out }) => {
    const verbs = registry.list();
    const width = Math.max(...verbs.map((verb) => verb.name.length));
    out("werk <verb> [arguments]");
    out("");
    for (const verb of verbs)
      out(`  ${verb.name.padEnd(width)}  ${verb.summary}`);
    return 0;
  },
});
