/** Escapes the five characters that can open markup or end an attribute, as numeric entities. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
