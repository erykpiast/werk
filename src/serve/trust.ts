/**
 * Decides whether a request is trusted: a loopback Host for every request, and the
 * server token for a request that changes state or starts an agent (#werk-serve-trust).
 */

const LOOPBACK_NAMES: readonly string[] = ["localhost", "127.0.0.1", "[::1]"];
const READ_ONLY_METHODS: readonly string[] = ["GET", "HEAD"];

/** The name part of a Host header value, with the port taken off. */
function hostName(host: string): string {
  const name = host.startsWith("[")
    ? host.slice(0, host.indexOf("]") + 1)
    : host.replace(/:\d*$/, "");
  return name.toLowerCase();
}

export function isLoopbackHost(host: string | null): boolean {
  return host !== null && LOOPBACK_NAMES.includes(hostName(host));
}

export type Trust = { ok: true } | { ok: false; reason: string };

export type TrustInput = {
  method: string;
  host: string | null;
  /** The token the request carries, if any. */
  token: string | null;
  /** The token this server made at its start. */
  expected: string;
};

export function judgeRequest(input: TrustInput): Trust {
  if (!isLoopbackHost(input.host)) {
    return { ok: false, reason: "the Host is not a loopback name" };
  }
  if (READ_ONLY_METHODS.includes(input.method.toUpperCase())) {
    return { ok: true };
  }
  if (input.token === null || input.token !== input.expected) {
    return { ok: false, reason: "a changing request needs the server token" };
  }
  return { ok: true };
}
