/** Reads the lines of an input stream one at a time. A line that nobody asked for yet waits in a backlog. */
export class LineReader {
  private buffer = "";
  private backlog: string[] = [];
  private reader: ReadableStreamDefaultReader<Uint8Array> | null;
  private decoder = new TextDecoder();
  private done = false;

  constructor(stream: ReadableStream<Uint8Array> | null) {
    this.reader = stream ? stream.getReader() : null;
    this.done = stream === null;
  }

  private async fetch(): Promise<string | null> {
    for (;;) {
      const at = this.buffer.indexOf("\n");
      if (at >= 0) {
        const line = this.buffer.slice(0, at);
        this.buffer = this.buffer.slice(at + 1);
        if (line.trim() !== "") return line;
        continue;
      }
      if (this.done || !this.reader) {
        const rest = this.buffer;
        this.buffer = "";
        return rest.trim() === "" ? null : rest;
      }
      const chunk = await this.reader.read();
      if (chunk.done) this.done = true;
      else this.buffer += this.decoder.decode(chunk.value, { stream: true });
    }
  }

  /** The next line, the backlog first. Null when the input has closed. */
  async next(): Promise<string | null> {
    return this.backlog.shift() ?? (await this.fetch());
  }

  /** The next line that `wanted` accepts. Other lines go to the backlog. Null when the input has closed. */
  async nextWhere(wanted: (line: string) => boolean): Promise<string | null> {
    for (;;) {
      const line = await this.fetch();
      if (line === null) return null;
      if (wanted(line)) return line;
      this.backlog.push(line);
    }
  }
}
