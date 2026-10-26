// Prints the names of every verb that the werk command line in <clone> registers, one per line.
// Usage: bun list-verbs.ts <clone>
const clone = process.argv[2];
if (clone === undefined) throw new Error("usage: bun list-verbs.ts <clone>");
await import(`${clone}/src/verbs/index.ts`);
const { registry } = (await import(`${clone}/src/cli/registry.ts`)) as {
  registry: { list(): { name: string }[] };
};
for (const verb of registry.list()) console.log(verb.name);
