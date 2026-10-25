/**
 * The three models the chat header offers, and the pinned ids each one launches with
 * (#werk-model-select, #opus-pin, #sonnet-pin).
 */
import { type ModelChoice, OPUS, SONNET } from "../agent/launch-options.ts";

/** What the header sends: a model family, and the advisor family or null. */
export type ModelPick = { model: "sonnet" | "opus"; advisor: "opus" | null };

/** A conversation with no saved choice starts here (#werk-advisor). */
export const DEFAULT_PICK: ModelPick = { model: "sonnet", advisor: "opus" };

/** The pick in a request or a saved file. Null for anything that is not one of the three. */
export function parsePick(value: unknown): ModelPick | null {
  if (typeof value !== "object" || value === null) return null;
  const { model, advisor } = value as Record<string, unknown>;
  if (model === "opus" && advisor === null) return { model, advisor };
  if (model === "sonnet" && (advisor === null || advisor === "opus")) {
    return { model, advisor };
  }
  return null;
}

/** The pinned ids that the spawn arguments carry. */
export function choiceOf(pick: ModelPick): ModelChoice {
  return {
    model: pick.model === "opus" ? OPUS : SONNET,
    advisor: pick.advisor === "opus" ? OPUS : null,
  };
}
