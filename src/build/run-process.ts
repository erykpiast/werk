/** Runs one child process to its end, with a time limit and a way to stop it from outside. */

export type ProcessOptions = {
  argv: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  /** Text written to the child's input, which is then closed. With none, the input is closed at once. */
  stdin?: string;
  timeoutMs: number;
  /** An abort stops the child. */
  signal?: AbortSignal;
  /** Called with each piece of output as it arrives, so a log can follow the child live. */
  onStdout?: (chunk: string) => void;
  /** Keeps the input open after `stdin`, so the caller can answer the child later and then close it. */
  keepStdin?: boolean;
  /** Called once the child runs, with the handle that reaches it from outside. */
  control?: (control: ProcessControl) => void;
};

export type ProcessControl = {
  pid: number;
  /** Writes text to the input of the child. */
  write: (text: string) => void;
  /** Closes the input of the child. */
  close: () => void;
  /** Stops the child. The reason comes back in the result. */
  stop: (reason: string) => void;
};

export type ProcessResult = {
  exitCode: number | null;
  timedOut: boolean;
  aborted: boolean;
  /** The reason that a caller gave when it stopped the child. */
  stopped?: string;
  stdout: string;
  stderr: string;
  /** Set when the program could not start. */
  spawnError?: string;
};

async function drain(
  stream: ReadableStream<Uint8Array>,
  onChunk?: (chunk: string) => void,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for await (const bytes of stream) {
    const chunk = decoder.decode(bytes, { stream: true });
    text += chunk;
    onChunk?.(chunk);
  }
  return text;
}

export async function runProcess(
  options: ProcessOptions,
): Promise<ProcessResult> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.env)) {
    if (value !== undefined) env[key] = value;
  }
  let child: Bun.Subprocess<"pipe", "pipe", "pipe">;
  try {
    child = Bun.spawn(options.argv, {
      cwd: options.cwd,
      env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    return {
      exitCode: null,
      timedOut: false,
      aborted: false,
      stdout: "",
      stderr: "",
      spawnError: (error as Error).message,
    };
  }
  let timedOut = false;
  let aborted = false;
  let stopped: string | undefined;
  const stop = () => child.kill();
  const timer = setTimeout(() => {
    timedOut = true;
    stop();
  }, options.timeoutMs);
  const onAbort = () => {
    aborted = true;
    stop();
  };
  if (options.signal?.aborted) onAbort();
  else options.signal?.addEventListener("abort", onAbort, { once: true });

  options.control?.({
    pid: child.pid,
    write: (text) => {
      try {
        child.stdin.write(text);
        void child.stdin.flush();
      } catch {
        // The child closed its input: there is nobody to answer.
      }
    },
    close: () => {
      try {
        void child.stdin.end();
      } catch {
        // Already closed.
      }
    },
    stop: (reason) => {
      stopped ??= reason;
      stop();
    },
  });
  try {
    // A child that exits before it reads its input closes the pipe: that is not an error here.
    if (options.stdin !== undefined) child.stdin.write(options.stdin);
    if (options.keepStdin) void child.stdin.flush();
    else await child.stdin.end();
  } catch {
    // The exit code tells what happened.
  }
  const [stdout, stderr, exitCode] = await Promise.all([
    drain(child.stdout, options.onStdout),
    drain(child.stderr),
    child.exited,
  ]);
  clearTimeout(timer);
  options.signal?.removeEventListener("abort", onAbort);
  return {
    exitCode: timedOut || aborted || stopped !== undefined ? null : exitCode,
    timedOut,
    aborted,
    ...(stopped === undefined ? {} : { stopped }),
    stdout,
    stderr,
  };
}
