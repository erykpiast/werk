// `quote` cites the words of a conversation as an excerpt (#werk-cli-recall-quote-form, #werk-excerpt-event-shape, #werk-excerpt-event-type).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cardId, parseArgs } from "../cli/args.ts";
import { registerVerb } from "../cli/registry.ts";
import type { FoldedMap } from "../map/fold.ts";
import { appendEvents, logPathFor, readMap } from "../map/log-store.ts";
import {
  isConversationName,
  matchQuote,
  missingParts,
  spokenMessages,
} from "../map/quote-match.ts";
import { isOut } from "../map/removal-rules.ts";

const USAGE =
  'usage: quote <card-id> <conversation> "the words"  (or --text "the words")';

/** The citing card's id with :ex and the first number that no node or removed card holds. */
function freeId(map: FoldedMap, card: string): string {
  let n = 0;
  while (map.nodes.has(`${card}:ex${n}`) || isOut(map, `${card}:ex${n}`)) n++;
  return `${card}:ex${n}`;
}

registerVerb({
  name: "quote",
  summary: "Cite the words of a conversation as an excerpt",
  run: ({ args, cwd, env, out, err }) => {
    const parsed = parseArgs(args, { flags: ["text"] });
    if (!parsed.ok) {
      err(`werk: ${parsed.error}\n${USAGE}`);
      return 2;
    }
    const [rawCard, conversation, argText, ...extra] = parsed.positional;
    if (
      rawCard === undefined ||
      conversation === undefined ||
      extra.length > 0
    ) {
      err(`werk: quote needs a card and a conversation\n${USAGE}`);
      return 2;
    }
    if (argText !== undefined && parsed.flags.text !== undefined) {
      err("werk: give the text once, as an argument or with --text");
      return 2;
    }
    const words = argText ?? parsed.flags.text;
    if (words === undefined) {
      err(`werk: quote needs the text to quote\n${USAGE}`);
      return 2;
    }
    if (!isConversationName(conversation)) {
      err(`werk: refused: "${conversation}" is not a conversation name`);
      return 1;
    }
    const logPath = logPathFor(cwd, env);
    const chatLog = join(dirname(logPath), "chats", `${conversation}.jsonl`);
    if (!existsSync(chatLog)) {
      err(`werk: refused: no chat log for conversation "${conversation}"`);
      return 1;
    }
    const found = matchQuote(
      spokenMessages(readFileSync(chatLog, "utf8")),
      words,
    );
    if (!found.ok) {
      err(`werk: refused: ${found.reason}`);
      return 1;
    }
    const { message, start, end } = found;
    const missing = missingParts(message);
    if (missing.length > 0) {
      err(
        `werk: refused: message ${message.position} has no ${missing.join(", ")}, so the pointer would be incomplete`,
      );
      return 1;
    }
    const card = cardId(rawCard);
    const id = freeId(readMap(logPath).map, card);
    const result = appendEvents(logPath, [
      {
        type: "excerpt.quoted",
        id,
        title: words,
        card,
        conversation,
        session: message.session,
        message: message.position,
        start,
        end,
        speaker: message.speaker,
        said_at: message.at,
      },
    ]);
    if (!result.ok) {
      err(
        `werk: refused: ${result.violation.rule}: ${result.violation.detail}`,
      );
      return 1;
    }
    out(
      `${id}: proposed, supports ${card}: conversation ${conversation}, message ${message.position}, span ${start}..${end}`,
    );
    return 0;
  },
});
