/** The answers a writer returns: card records the plan proposes as ghosts (#st-spec-answers, #st-spec-decisions). Pure. */

export type Answer = { slug: string; title: string; why: string; body: string };

export type ParsedAnswers =
  | { ok: true; answers: Answer[] }
  | { ok: false; error: string };

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/** Reads the text of an answers file: a JSON list of records with a slug, a title, a why and a body. An empty list is no answers. */
export function parseAnswers(text: string): ParsedAnswers {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `not JSON: ${(error as Error).message}` };
  }
  if (!Array.isArray(data))
    return { ok: false, error: "the answers file is a JSON list" };
  const answers: Answer[] = [];
  for (const [index, item] of data.entries()) {
    const where = `answer ${index + 1}`;
    if (typeof item !== "object" || item === null || Array.isArray(item))
      return { ok: false, error: `${where} is not an object` };
    const rec = item as Record<string, unknown>;
    for (const key of ["slug", "title", "why", "body"]) {
      if (typeof rec[key] !== "string" || rec[key] === "")
        return { ok: false, error: `${where} needs a text ${key}` };
    }
    const slug = rec.slug as string;
    if (!SLUG.test(slug))
      return {
        ok: false,
        error: `${where}: the slug "${slug}" is lower-case words joined by hyphens`,
      };
    if (answers.some((other) => other.slug === slug))
      return {
        ok: false,
        error: `${where}: the slug "${slug}" is given twice`,
      };
    answers.push({
      slug,
      title: rec.title as string,
      why: rec.why as string,
      body: rec.body as string,
    });
  }
  return { ok: true, answers };
}

/** The card id of an answer: the root id, a hyphen, and the slug. */
export const answerId = (root: string, answer: Answer): string =>
  `${root}-${answer.slug}`;

/** The event that proposes one answer as a ghost under the root, decided by the agent. */
export function proposalEvent(root: string, answer: Answer) {
  return {
    type: "node.proposed",
    id: answerId(root, answer),
    kind: "card",
    title: answer.title,
    why: answer.why,
    body: answer.body,
    status: "open",
    who: "me",
    parent: root,
  };
}
