// HTML escaping for rendered card text (#werk-progress). Every rule of the renderer runs on
// escaped text, so a raw tag in card text never reaches the page.

/** Each character that can open markup or an attribute, with the entity that replaces it. */
export const ENTITIES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ENTITIES[char] ?? char);
}

/** The character that an entity at the very end of `escaped` stands for, if one ends there. */
export function entityCharAtEnd(escaped: string): string | undefined {
  for (const [char, entity] of Object.entries(ENTITIES)) if (escaped.endsWith(entity)) return char;
  return undefined;
}
