/** The cost of one agent session, read from the result line of its stream (#ms-cost). Pure. */

export type Cost = {
  usd: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export const NO_COST: Cost = {
  usd: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

/** The cost that the last result line of the transcript reports. A stream with none costs nothing. */
export function costOf(transcript: string): Cost {
  const lines = transcript.split("\n").reverse();
  for (const line of lines) {
    if (!line.includes('"result"')) continue;
    try {
      const event = JSON.parse(line);
      if (event?.type !== "result") continue;
      const usage = event.usage ?? {};
      return {
        usd: num(event.total_cost_usd),
        input: num(usage.input_tokens),
        output: num(usage.output_tokens),
        cacheRead: num(usage.cache_read_input_tokens),
        cacheWrite: num(usage.cache_creation_input_tokens),
      };
    } catch {
      // A line that is not JSON is not a result.
    }
  }
  return NO_COST;
}
