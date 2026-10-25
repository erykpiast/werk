/** The list of open tickets that a plan drops, read from the ticket writer's file (#st-plan-archive). Pure. */

export type Drop = { ticket: number; why: string };

export type ParsedDrops =
  | { ok: true; drops: Drop[] }
  | { ok: false; error: string };

export function parseDrops(raw: string): ParsedDrops {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      error: `not JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!Array.isArray(value)) return { ok: false, error: "not a JSON list" };
  const drops: Drop[] = [];
  for (const [index, item] of value.entries()) {
    const record = item as { ticket?: unknown; why?: unknown } | null;
    const ticket = Number(record?.ticket);
    const why = record?.why;
    if (!Number.isInteger(ticket) || ticket < 1)
      return { ok: false, error: `item ${index + 1} needs a ticket number` };
    if (typeof why !== "string" || why.trim() === "")
      return { ok: false, error: `item ${index + 1} needs a why` };
    drops.push({ ticket, why: why.trim() });
  }
  return { ok: true, drops };
}
