// Runs once in each test worker, after the environment preload (see bunfig.toml). See #werk-test-dom.
// One DOM window is registered before any test file loads, so React finds a DOM when it first loads.
// The runtime's network, stream and timer globals are put back, so a server test in the same
// worker calls the real network function, not the DOM's (#werk-test-globals).
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const RUNTIME_GLOBALS = [
  "fetch",
  "Request",
  "Response",
  "Headers",
  "FormData",
  "WebSocket",
  "AbortController",
  "AbortSignal",
  "ReadableStream",
  "WritableStream",
  "TransformStream",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "setImmediate",
  "clearImmediate",
  "queueMicrotask",
] as const;

const scope = globalThis as unknown as Record<string, unknown>;
const runtime = new Map(RUNTIME_GLOBALS.map((name) => [name, scope[name]]));

GlobalRegistrator.register();

for (const [name, value] of runtime) {
  if (value === undefined) delete scope[name];
  else scope[name] = value;
}

// React checks this flag before it lets a test update state outside the scheduler.
scope.IS_REACT_ACT_ENVIRONMENT = true;
