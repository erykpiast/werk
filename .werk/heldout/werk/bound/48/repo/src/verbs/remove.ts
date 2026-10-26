// `werk remove` takes a card out of the map with its refines subtree, or with --reparent moves its
// children up and takes only the card; `werk restore` undoes one removal (#werk-remove,
// #werk-remove-restore-undo). Both refuse unless they state that the person asked for them.
// `werk removed` lists what is out.
import { registerVerb } from "../cli/registry.ts";
import { removalOf } from "../map/removal.ts";
import { formatProblems, stagedLines, titleOf } from "../map/show.ts";
import { logPath, readMap, write } from "../map/store.ts";
import type { FoldedMap, Removal } from "../map/types.ts";

const ACTOR_FLAG = { name: "actor", value: "text", help: "you: the person asked for this." } as const;

function refusedWithoutActor(verb: string, actor: string | true | undefined, err: (text: string) => void): boolean {
  if (actor === "you") return false;
  err(
    `werk ${verb}: refused: a ${verb} is the person's. They press the control on the card in the map.\n` +
      `  If they asked for this ${verb}, pass --actor you.\n`,
  );
  return true;
}

/** The nodes of a removal, then each child it moved and where to. */
function removalLines(map: FoldedMap, id: string, removal: Removal, verb: string, back: boolean): string {
  const moved = removal.moved;
  const lines = (moved?.children ?? []).map((child) => {
    const where = back ? `back under ${id}` : `up to ${moved?.to}`;
    return `  moved ${child}  ${titleOf(map, child)}  ${where}\n`;
  });
  return stagedLines(map, id, removal.taken, verb) + lines.join("");
}

registerVerb({
  name: "remove",
  help: "Take a card out of the map with its subtree, or with --reparent only the card. Only the person removes.",
  positionals: [{ name: "id", value: "id" }],
  flags: [ACTOR_FLAG, { name: "reparent", help: "Move the card's direct children up to its parent." }],
  run: ({ positionals, flags }, io) => {
    if (refusedWithoutActor("remove", flags.actor, io.err)) return 1;
    const id = positionals[0] as string;
    const reparent = flags.reparent === true;
    const log = logPath();
    const map = readMap("remove", log);
    io.err(formatProblems(map.problems));
    write(map, [{ type: "node.removed", actor: "you", payload: reparent ? { id, reparent } : { id } }], log);
    io.out(removalLines(map, id, removalOf(map, id, reparent), "removed", false));
    return 0;
  },
});

registerVerb({
  name: "restore",
  help: "Undo the removal that named a card: the card and all it took come back. Only the person restores.",
  positionals: [{ name: "id", value: "id" }],
  flags: [ACTOR_FLAG],
  run: ({ positionals, flags }, io) => {
    if (refusedWithoutActor("restore", flags.actor, io.err)) return 1;
    const id = positionals[0] as string;
    const log = logPath();
    const map = readMap("restore", log);
    io.err(formatProblems(map.problems));
    write(map, [{ type: "node.restored", actor: "you", payload: { id } }], log);
    io.out(removalLines(map, id, map.removals.get(id) as Removal, "restored", true));
    return 0;
  },
});

// A person can list what is out (#werk-remove).
registerVerb({
  name: "removed",
  help: "List each removal: the card it named, and every node it took out.",
  run: (_args, io) => {
    const map = readMap("removed", logPath());
    io.err(formatProblems(map.problems));
    if (map.removals.size === 0) {
      io.out("no card is removed\n");
      return 0;
    }
    for (const [id, removal] of map.removals) io.out(removalLines(map, id, removal, "removed", false));
    return 0;
  },
});
