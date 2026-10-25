/** Puts the synchronizer token into a page, so the page can send it with a changing request (#werk-serve-trust). */

/** Escapes the characters that end an attribute value. */
function attribute(value: string): string {
  return value.replace(/[&"<>]/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** The page with a token meta tag as the first element of its head. A page with no head gets one. */
export function injectToken(html: string, token: string): string {
  const meta = `<meta name="werk-token" content="${attribute(token)}">`;
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) {
    const end = head.index + head[0].length;
    return html.slice(0, end) + meta + html.slice(end);
  }
  return `<!doctype html><head>${meta}</head>${html.replace(/^<!doctype html>/i, "")}`;
}

/** The token that a page carries, or null when it has none. The reverse of injectToken. */
export function tokenOf(html: string): string | null {
  const found = /<meta name="werk-token" content="([^"]*)">/.exec(html);
  if (!found) return null;
  return (found[1] as string).replace(/&#(\d+);/g, (_m, code: string) =>
    String.fromCharCode(Number(code)),
  );
}
