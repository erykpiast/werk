/**
 * The turns of one conversation that were sent and have not ended, in the order they were sent.
 * The oldest one is the active turn: it is the only one the agent works on, and every part of the
 * reply belongs to it (#werk-chat-turn-id).
 */

export type Sent = {
  /** The name the browser gave the turn when it sent it. */
  turn: string;
  text: string;
  /** The card the person had open, or null for the whole tree. */
  card: string | null;
  /** The absolute paths of the stored images, in the order of their tokens. */
  images?: string[];
};

export type Queue = { active: Sent | null; waiting: Sent[] };

export const emptyQueue: Queue = { active: null, waiting: [] };

/** True when a turn with this name is active or waiting. */
export function holds(queue: Queue, turn: string): boolean {
  return (
    queue.active?.turn === turn || queue.waiting.some((w) => w.turn === turn)
  );
}

/** Adds a turn. `start` is the turn the agent gets now: the new one when nothing was active. */
export function enqueue(
  queue: Queue,
  sent: Sent,
): { queue: Queue; start: Sent | null } {
  if (queue.active === null) {
    return { queue: { active: sent, waiting: queue.waiting }, start: sent };
  }
  return {
    queue: { active: queue.active, waiting: [...queue.waiting, sent] },
    start: null,
  };
}

/** The end line closes the active turn, and the next waiting turn starts. */
export function finish(queue: Queue): {
  queue: Queue;
  ended: string | null;
  start: Sent | null;
} {
  const [next, ...rest] = queue.waiting;
  return {
    queue: { active: next ?? null, waiting: rest },
    ended: queue.active?.turn ?? null,
    start: next ?? null,
  };
}

/** An exit of the agent ends every open turn, so none waits for a reply that cannot come. */
export function exitAll(queue: Queue): { queue: Queue; ended: string[] } {
  const open = queue.active ? [queue.active, ...queue.waiting] : [];
  return { queue: emptyQueue, ended: open.map((sent) => sent.turn) };
}
