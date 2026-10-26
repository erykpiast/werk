// `werk quote` cites a conversation verbatim: it finds the text once in a spoken message of the
// conversation's chat log, and writes a ghost excerpt with its pointer and its held link from the
// citing card, as one event (#werk-excerpt, #werk-excerpt-once, #werk-excerpt-event,
// #werk-excerpt-pointer). Any other count refuses, says which case it found, and writes nothing.
// The command form and its output line: #werk-excerpt-cli-form.
import { existsSync, readFileSync } from "node:fs";
import { registerVerb } from "../cli/registry.ts";
import { chatLogPath, describeMiss, matchQuote, readChat } from "../map/chat.ts";
import { formatProblems } from "../map/show.ts";
import { logPath, readMap, write } from "../map/store.ts";
import type { FoldedMap } from "../map/types.ts";

/** The first free excerpt id of a card: `<card>:ex0`, then `:ex1`, and so on. */
function excerptId(map: FoldedMap, card: string): string {
  let n = 0;
  while (map.nodes.has(`${card}:ex${n}`)) n++;
  return `${card}:ex${n}`;
}

registerVerb({
  name: "quote",
  help: "Quote the words of one spoken message of a conversation as an excerpt that supports a card.",
  positionals: [
    { name: "card", value: "id" },
    { name: "conversation", value: "text" },
    { name: "text", value: "text", optional: true },
  ],
  flags: [{ name: "text", value: "text", help: "The words to quote, exactly as they were said." }],
  run: ({ positionals, flags }, io) => {
    const [card, conversation, given] = positionals as [string, string, string | undefined];
    // The text comes as the third argument or with --text, never both (#werk-excerpt-cli-form).
    if (given !== undefined && flags.text !== undefined) {
      io.err("werk quote: give the text once, as an argument or with --text\n");
      return 1;
    }
    const quote = given ?? (typeof flags.text === "string" ? flags.text : "");
    if (quote === "") {
      io.err("werk quote: needs the text to quote\n");
      return 1;
    }
    const log = logPath();
    const chat = chatLogPath(log, conversation);
    if (chat === undefined) {
      io.err(`werk quote: a conversation name is letters, digits, dots, dashes and underscores: ${conversation}\n`);
      return 1;
    }
    if (!existsSync(chat)) {
      io.err(`werk quote: conversation ${conversation} has no chat log at ${chat}\n`);
      return 1;
    }
    const match = matchQuote(readChat(readFileSync(chat, "utf8")), quote);
    if (!match.ok) {
      io.err(`werk quote: refused: ${describeMiss(match, conversation)}\n`);
      return 1;
    }
    const map = readMap("quote", log);
    io.err(formatProblems(map.problems));
    const id = excerptId(map, card);
    const { message, start, end, line } = match;
    const payload = {
      id,
      title: quote,
      card,
      conversation,
      session: line.session,
      message,
      start,
      end,
      speaker: line.speaker,
      said_at: line.at,
    };
    write(map, [{ type: "excerpt.quoted", actor: "agent", payload }], log);
    io.out(
      `${id}: proposed, supports ${card}: conversation ${conversation}, message ${message}, span ${start}..${end}\n`,
    );
    return 0;
  },
});
