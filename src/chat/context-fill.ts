/**
 * The numbers of the context-fill pie: the tokens in use, and the window they fill
 * (#werk-context-pie, #werk-model-persist).
 */

const SMALL_WINDOW = 200_000;
const LARGE_WINDOW = 1_000_000;

/** The window a model has before a turn reports the real one: a one-million-token id has a million. */
export function windowOf(model: string): number {
  return model.endsWith("[1m]") ? LARGE_WINDOW : SMALL_WINDOW;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** The size of the conversation at one API call: input, output, cache-read and cache-creation tokens. */
export function usageTokens(usage: unknown): number {
  if (typeof usage !== "object" || usage === null) return 0;
  const u = usage as Record<string, unknown>;
  return (
    count(u.input_tokens) +
    count(u.output_tokens) +
    count(u.cache_read_input_tokens) +
    count(u.cache_creation_input_tokens)
  );
}

const withoutSuffix = (id: string) => id.replace(/\[[^\]]*\]$/, "");

/**
 * The window that a turn's final result reports for the conversation's own model. The entry of the
 * advisor can list first and has a smaller window, so it is never taken for the model's. Null when
 * the result holds no entry for the model.
 */
export function windowFromResult(
  modelUsage: unknown,
  model: string,
): number | null {
  if (typeof modelUsage !== "object" || modelUsage === null) return null;
  const entries = Object.entries(modelUsage as Record<string, unknown>);
  const own =
    entries.find(([id]) => id === model) ??
    entries.find(([id]) => withoutSuffix(id) === withoutSuffix(model));
  const size = (own?.[1] as { contextWindow?: unknown } | undefined)
    ?.contextWindow;
  return typeof size === "number" && size > 0 ? size : null;
}
