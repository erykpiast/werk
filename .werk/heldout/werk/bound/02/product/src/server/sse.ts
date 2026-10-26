/** One server-sent event, in the wire format. */
export function sseEvent(event: string, data: unknown): string {
  const lines = JSON.stringify(data).split('\n')
  return `event: ${event}\n${lines.map((line) => `data: ${line}`).join('\n')}\n\n`
}
