/**
 * The numbering of pasted images in the composer: each image is a chip and a token in the text, and
 * the numbers stay 1..n in the order of the chips (#werk-shot-chip, #werk-chat-image-inline).
 */

export type Chip = {
  id: string;
  state: "uploading" | "ready" | "refused";
  /** The stored file's name, once the server answered. */
  name?: string;
  /** Why the server refused the image. */
  reason?: string;
};

export const tokenOf = (n: number) => `[Image #${n}]`;

const TOKEN = /\[Image #(\d+)\]/g;

/** Puts the token at the caret, and says where the caret goes: just after the token. */
export function insertToken(
  text: string,
  caret: number,
  n: number,
): { text: string; caret: number } {
  const at = Math.min(Math.max(caret, 0), text.length);
  const token = tokenOf(n);
  return {
    text: text.slice(0, at) + token + text.slice(at),
    caret: at + token.length,
  };
}

/** Takes the token of chip n out of the text, and renumbers the tokens after it. */
export function removeToken(text: string, n: number): string {
  return text.replace(TOKEN, (token, digits: string) => {
    const found = Number(digits);
    if (found === n) return "";
    return found > n ? tokenOf(found - 1) : token;
  });
}

/**
 * What a send carries: the text without the tokens of refused images, and the stored names of the
 * rest in the order of their tokens.
 */
export function settleSend(
  text: string,
  chips: readonly Chip[],
): { text: string; names: string[] } {
  let settled = text;
  for (let i = chips.length - 1; i >= 0; i--) {
    if (chips[i]?.state === "refused") settled = removeToken(settled, i + 1);
  }
  const names = chips.flatMap((chip) =>
    chip.state === "ready" && chip.name !== undefined ? [chip.name] : [],
  );
  return { text: settled, names };
}
