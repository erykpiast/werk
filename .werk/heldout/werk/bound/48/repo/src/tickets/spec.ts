// Reads the story numbers of a spec (#st-ticket-stories, #werk-ticket-check-verb-form): the
// numbered lines under its `User stories` heading, up to the next heading of the same level or higher.

/** The story numbers in file order, or undefined when the spec has no `User stories` heading. */
export function specStories(text: string): number[] | undefined {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^#{1,6}[ \t]+User stories\s*$/i.test(line));
  if (start === -1) return undefined;
  const level = (/^#+/.exec(lines[start] as string) as RegExpExecArray)[0].length;
  const stories: number[] = [];
  for (const line of lines.slice(start + 1)) {
    const heading = /^(#{1,6})[ \t]/.exec(line);
    if (heading !== null && (heading[1] as string).length <= level) break;
    const story = /^(\d+)\.[ \t]/.exec(line);
    if (story !== null) stories.push(Number(story[1]));
  }
  return stories;
}
