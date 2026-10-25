/** The story numbers of a spec: the numbered lines under its "User stories" heading. Pure. */

const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const STORY = /^\s*(\d+)\.\s/;

/**
 * The numbers under the heading, up to the next heading of the same level or higher.
 * A spec with no such heading gives null.
 */
export function storiesOf(spec: string): string[] | null {
  const stories: string[] = [];
  let level: number | null = null;
  for (const line of spec.split("\n")) {
    const heading = HEADING.exec(line);
    if (heading) {
      const depth = (heading[1] as string).length;
      if (level === null) {
        if ((heading[2] as string).toLowerCase() === "user stories")
          level = depth;
      } else if (depth <= level) break;
      continue;
    }
    if (level === null) continue;
    const story = STORY.exec(line);
    if (story) stories.push(String(Number(story[1])));
  }
  return level === null ? null : stories;
}
