/** One step of a reply. The fake plays the steps of a reply in order. */
export type Step =
  | { event: Record<string, unknown> }
  | { edit: string; content: string }
  | { pause: number }
  | {
      ask: {
        id: string;
        tool: string;
        input?: Record<string, unknown>;
        /** The engine's reason, and the widening updates it attaches. */
        reason?: string;
        suggestions?: Record<string, unknown>[];
      };
    }
  | { crash: number };

export type Reply = Step[];

export type RoleScript = { replies: Reply[]; exit?: number };

/** The script of one temporary project: replies and an exit code for each role. */
export type Script = { roles: Record<string, RoleScript> };

export type Pick = { reply: Reply; exit: number } | { error: string };

const STEP_KEYS = ["event", "edit", "pause", "ask", "crash"] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkStep(step: unknown, where: string): Step {
  if (!isObject(step)) throw new Error(`${where} is not an object`);
  const keys = STEP_KEYS.filter((key) => key in step);
  if (keys.length !== 1) {
    throw new Error(
      `${where} must have exactly one of ${STEP_KEYS.join(", ")}`,
    );
  }
  if ("event" in step && !isObject(step.event)) {
    throw new Error(`${where}: event must be an object`);
  }
  if ("edit" in step) {
    if (typeof step.edit !== "string" || typeof step.content !== "string") {
      throw new Error(`${where}: edit needs a path and a content, both text`);
    }
  }
  if ("pause" in step && typeof step.pause !== "number") {
    throw new Error(`${where}: pause must be a number of milliseconds`);
  }
  if ("ask" in step) {
    const ask = step.ask;
    if (
      !isObject(ask) ||
      typeof ask.id !== "string" ||
      typeof ask.tool !== "string"
    ) {
      throw new Error(`${where}: ask needs an id and a tool, both text`);
    }
  }
  if ("crash" in step && typeof step.crash !== "number") {
    throw new Error(`${where}: crash must be an exit code`);
  }
  return step as Step;
}

/** Parses the text of a script file. Throws an error that names what is wrong. */
export function parseScript(text: string): Script {
  const data: unknown = JSON.parse(text);
  if (!isObject(data) || !isObject(data.roles)) {
    throw new Error("the script needs a roles object");
  }
  const roles: Record<string, RoleScript> = {};
  for (const [role, entry] of Object.entries(data.roles)) {
    if (!isObject(entry) || !Array.isArray(entry.replies)) {
      throw new Error(`role ${role} needs a replies list`);
    }
    const exit = entry.exit ?? 0;
    if (typeof exit !== "number")
      throw new Error(`role ${role}: exit must be a number`);
    const replies = entry.replies.map((reply, i) => {
      if (!Array.isArray(reply))
        throw new Error(`role ${role}, reply ${i + 1} is not a list`);
      return reply.map((step, j) =>
        checkStep(step, `role ${role}, reply ${i + 1}, step ${j + 1}`),
      );
    });
    roles[role] = { replies, exit };
  }
  return { roles };
}

/**
 * Picks the reply for a launch: the one after the replies that earlier
 * launches of the role played. A role with no reply left gets an error.
 */
export function pickReply(
  script: Script,
  role: string,
  earlierLaunches: number,
): Pick {
  const entry = script.roles[role];
  const count = entry?.replies.length ?? 0;
  const reply = entry?.replies[earlierLaunches];
  if (!entry || !reply) {
    return {
      error: `fake agent: role ${role} has ${count} replies and launch ${earlierLaunches + 1} has none`,
    };
  }
  return { reply, exit: entry.exit ?? 0 };
}

/** A chat role plays one reply per message, so its reply is picked by turn. */
export function isChatRole(role: string): boolean {
  return role === "chat";
}
