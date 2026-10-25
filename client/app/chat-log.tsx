import { renderMarkdown } from "../../src/md/markdown";
import {
  briefOf,
  type ChatState,
  endLine,
  type Item,
  rowsOf,
  type Turn,
  toolSummary,
} from "../lib/chat-log";

const noCards = () => false;

function inputText(call: Item): string {
  if (typeof call.input === "string") return call.input;
  return call.input === undefined ? "" : JSON.stringify(call.input, null, 2);
}

/** A run of tool calls, collapsed to the latest call and the count (#werk-tool-collapse). */
function ToolRun({ calls }: { calls: Item[] }) {
  const { latest, count } = toolSummary(calls);
  return (
    <details data-slot="tool-run">
      <summary>
        <span data-slot="tool-latest">{latest}</span>{" "}
        <span data-slot="tool-count">{count}</span>{" "}
        {count === 1 ? "call" : "calls"}
      </summary>
      {calls.map((call) => (
        <div key={call.id} data-slot="tool-call">
          <div>
            <strong>{call.name}</strong> {briefOf(call)}
          </div>
          <pre>{inputText(call)}</pre>
          {call.result ? (
            <pre data-error={call.result.isError || undefined}>
              {call.result.text}
            </pre>
          ) : null}
        </div>
      ))}
    </details>
  );
}

function Block({ item }: { item: Item }) {
  if (item.kind === "thinking") {
    return (
      <details data-kind="thinking">
        <summary>thinking</summary>
        <div className="whitespace-pre-wrap">{item.text}</div>
      </details>
    );
  }
  return (
    <div
      data-kind="text"
      // The renderer escapes every piece of text before it adds a tag (#werk-progress).
      // biome-ignore lint/security/noDangerouslySetInnerHtml: escaped by the renderer
      dangerouslySetInnerHTML={{ __html: renderMarkdown(item.text, noCards) }}
    />
  );
}

function TurnView({ turn }: { turn: Turn }) {
  return (
    <article data-turn={turn.name}>
      {turn.text === null ? null : <div data-role="user">{turn.text}</div>}
      {turn.waiting ? (
        <div data-slot="waiting">○ waits for the reply above</div>
      ) : null}
      {rowsOf(turn.items).map((row) =>
        row.type === "tools" ? (
          <ToolRun key={row.id} calls={row.calls} />
        ) : (
          <Block key={row.item.id} item={row.item} />
        ),
      )}
      {turn.end ? (
        <div data-slot="turn-end" data-error={turn.end.error || undefined}>
          {endLine(turn.end)}
        </div>
      ) : null}
    </article>
  );
}

/** The chat log: each turn with its message, then its reply parts in order. */
export function ChatLog({ state }: { state: ChatState }) {
  return (
    <div data-slot="chat-log" role="log" aria-label="Conversation">
      {state.turns.map((turn) => (
        <TurnView key={turn.name} turn={turn} />
      ))}
    </div>
  );
}
