import { useEffect } from "react";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import { callText, letter } from "../lib/ask";
import {
  type ChatState,
  type PendingAsk,
  pickedOf,
  picksToSend,
  type Selection,
} from "../lib/chat-log";
import type { ChatStore } from "../lib/chat-store";

function Permission({ ask, store }: { ask: PendingAsk; store: ChatStore }) {
  const send = (decision: "allow" | "always" | "deny") =>
    void store.answer(ask.id, { decision });
  return (
    <>
      <div data-slot="ask-head">
        <strong>{ask.tool}</strong> wants to run. The turn is waiting.
      </div>
      <pre data-slot="ask-call">{callText(ask)}</pre>
      {ask.reason === null ? null : (
        <div data-slot="ask-reason">
          Claude Code could not decide: <code>{ask.reason}</code>
        </div>
      )}
      <div data-slot="ask-buttons">
        <Button
          variant="default"
          disabled={ask.sending}
          onClick={() => send("allow")}
        >
          Allow once
        </Button>
        {ask.suggestion === null ? null : (
          <Button disabled={ask.sending} onClick={() => send("always")}>
            Always allow <code>{ask.suggestion}</code>
          </Button>
        )}
        <Button disabled={ask.sending} onClick={() => send("deny")}>
          Deny
        </Button>
      </div>
    </>
  );
}

function QuestionForm({
  ask,
  selections,
  store,
}: {
  ask: PendingAsk;
  selections: Selection[];
  store: ChatStore;
}) {
  const picks = picksToSend(selections);
  return (
    <>
      <div data-slot="ask-head">
        <strong>The agent</strong> asks. The turn is waiting.
      </div>
      {(ask.questions ?? []).map((q, qi) => {
        const chosen = selections[qi] as Selection;
        const change = (next: Selection) => store.pick(ask.id, qi, next);
        return (
          <fieldset key={q.question} data-slot="ask-question">
            <legend>
              {q.header === null ? null : <small>{q.header} · </small>}
              {q.question}
            </legend>
            {q.options.map((option, oi) => (
              <label key={option.label} data-slot="ask-option">
                <input
                  type={q.multiSelect ? "checkbox" : "radio"}
                  name={`${ask.id}:${qi}`}
                  checked={chosen.labels.includes(option.label)}
                  disabled={ask.sending}
                  onChange={(event) => {
                    const on = event.target.checked;
                    change({
                      ...chosen,
                      labels: q.multiSelect
                        ? on
                          ? [...chosen.labels, option.label]
                          : chosen.labels.filter((l) => l !== option.label)
                        : [option.label],
                    });
                  }}
                />{" "}
                <strong>{letter(oi)}.</strong> {option.label}
                {option.description === "" ? null : (
                  <span data-slot="ask-description"> {option.description}</span>
                )}
              </label>
            ))}
            <Textarea
              aria-label={`Other answer to: ${q.question}`}
              placeholder="Another answer"
              className="min-h-10"
              value={chosen.other}
              disabled={ask.sending}
              onChange={(event) =>
                change({ ...chosen, other: event.target.value })
              }
            />
          </fieldset>
        );
      })}
      <div data-slot="ask-buttons">
        <Button
          variant="default"
          disabled={ask.sending || picks === null}
          onClick={() =>
            picks && void store.answer(ask.id, { decision: "answer", picks })
          }
        >
          Submit answer
        </Button>
        <Button
          disabled={ask.sending}
          onClick={() => void store.answer(ask.id, { decision: "decline" })}
        >
          Decline
        </Button>
      </div>
    </>
  );
}

/**
 * The approval bar, above the composer: every open ask, oldest first. Cmd+Enter allows and Escape
 * denies the first one, and the key never reaches the composer (#werk-approve-bar, #werk-cmdenter).
 */
export function AskBar({
  state,
  store,
}: {
  state: ChatState;
  store: ChatStore;
}) {
  const first = state.asks[0];
  useEffect(() => {
    if (!first || first.sending) return;
    const onKey = (event: KeyboardEvent) => {
      const yes = event.key === "Enter" && (event.metaKey || event.ctrlKey);
      if (!yes && event.key !== "Escape") return;
      let answer: Parameters<ChatStore["answer"]>[1] | null;
      if (first.questions === null) {
        answer = { decision: yes ? "allow" : "deny" };
      } else if (yes) {
        const picks = picksToSend(pickedOf(state, first));
        answer = picks && { decision: "answer", picks };
      } else {
        answer = { decision: "decline" };
      }
      // The composer must not also take the key (#werk-cmdenter).
      event.stopPropagation();
      event.preventDefault();
      if (answer) void store.answer(first.id, answer);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [first, state, store]);
  if (state.asks.length === 0) return null;
  return (
    <div data-slot="ask-bar">
      {state.asks.map((ask) => (
        <section key={ask.id} data-slot="ask" aria-label={`${ask.tool} ask`}>
          {ask.questions === null ? (
            <Permission ask={ask} store={store} />
          ) : (
            <QuestionForm
              ask={ask}
              selections={pickedOf(state, ask)}
              store={store}
            />
          )}
        </section>
      ))}
    </div>
  );
}
