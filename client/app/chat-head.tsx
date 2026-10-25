import { useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import { Popover } from "../components/ui/popover";
import {
  type ChatState,
  formatTokens,
  headOf,
  type ModelSettings,
} from "../lib/chat-log";
import type { ChatStore } from "../lib/chat-store";
import { pieGradient, pieOf } from "../lib/context-pie";

const CHOICES = [
  { value: "sonnet", label: "Sonnet", model: "sonnet", advisor: null },
  { value: "opus", label: "Opus", model: "opus", advisor: null },
  {
    value: "sonnet+opus",
    label: "Sonnet + Opus advisor",
    model: "sonnet",
    advisor: "opus",
  },
] as const;

const selectValue = (settings: ModelSettings) =>
  settings.advisor === null ? settings.model : "sonnet+opus";

/**
 * The chat header row: the turn state, with a pulse, what the agent does, seconds and tokens
 * (#werk-progress); the model selector and the context-fill pie with its clear-context popover
 * (#werk-model-select, #werk-context-pie). It sits directly above the composer (#werk-head-bottom).
 */
export function ChatHead({
  state,
  store,
}: {
  state: ChatState;
  store: Pick<ChatStore, "setModel" | "clearContext">;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const busy = headOf(state, now).busy;
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  const head = headOf(state, now);
  const { settings } = state;
  const pie = settings ? pieOf(settings.used, settings.window) : null;
  const report = async (done: Promise<string | null>) => setRefused(await done);
  return (
    <div data-slot="chat-head" data-busy={head.busy || undefined}>
      <span data-slot="pulse" aria-hidden="true" />
      <span data-slot="chat-state">{head.label}</span>
      {head.seconds === null ? null : <span>{head.seconds}s</span>}
      {head.tokens === null ? null : <span>{formatTokens(head.tokens)}</span>}
      {settings === null ? null : (
        <span data-slot="chat-model-controls">
          <select
            aria-label="Model"
            data-slot="model-select"
            value={selectValue(settings)}
            disabled={head.busy}
            onChange={(event) => {
              const choice = CHOICES.find(
                (c) => c.value === event.target.value,
              );
              if (choice) {
                void report(store.setModel(choice.model, choice.advisor));
              }
            }}
          >
            {CHOICES.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
          <span data-slot="context-pie-box">
            <button
              type="button"
              data-slot="context-pie"
              data-level={pie?.level}
              aria-label={`Context ${pie?.percent ?? 0}% full`}
              aria-expanded={open}
              style={{ background: pie ? pieGradient(pie) : undefined }}
              onClick={() => setOpen(!open)}
            />
            {open ? (
              <Popover role="dialog" aria-label="Context">
                <span data-slot="context-percent">
                  {pie?.percent ?? 0}% of the context window is in use
                </span>
                <Button
                  disabled={head.busy}
                  onClick={() => {
                    setOpen(false);
                    void report(store.clearContext());
                  }}
                >
                  Clear context
                </Button>
              </Popover>
            ) : null}
          </span>
        </span>
      )}
      {refused === null ? null : <span role="alert">{refused}</span>}
    </div>
  );
}
