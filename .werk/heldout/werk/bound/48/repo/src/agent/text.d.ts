// A prompt text imported with `{ type: "text" }` is its contents as one string. Bun embeds it, so
// the built executable carries the shipped texts (#werk-dist).
declare module "*.md" {
  const text: string;
  export default text;
}
