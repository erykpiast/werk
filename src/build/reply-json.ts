/** The JSON object that ends the reply of a judge agent. Pure. */

/** The whole text, the last fenced block, or the outermost braces, whichever parses first. Undefined when none does. */
export function jsonOf(reply: string): unknown {
  const candidates: string[] = [reply.trim()];
  const fenced = [...reply.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)];
  const last = fenced[fenced.length - 1];
  if (last?.[1] !== undefined) candidates.push(last[1]);
  const open = reply.indexOf("{");
  const close = reply.lastIndexOf("}");
  if (open >= 0 && close > open) candidates.push(reply.slice(open, close + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // The next form.
    }
  }
  return undefined;
}

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
