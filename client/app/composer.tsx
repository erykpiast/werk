import { useState } from "react";
import { Textarea } from "../components/ui/textarea";
import { restoreDraft } from "../lib/draft";

/**
 * The composer. A draft that the last load stashed comes back once (#werk-client-reload).
 * Enter sends the message, and Shift+Enter starts a new line.
 */
export function Composer({ onSend }: { onSend?: (text: string) => void }) {
  const [text, setText] = useState(() => restoreDraft(sessionStorage));
  return (
    <Textarea
      data-composer
      aria-label="Message"
      placeholder="Message the agent"
      value={text}
      onChange={(event) => setText(event.target.value)}
      onKeyDown={(event) => {
        if (
          event.key !== "Enter" ||
          event.shiftKey ||
          event.nativeEvent.isComposing
        ) {
          return;
        }
        event.preventDefault();
        const message = text.trim();
        if (message === "" || !onSend) return;
        onSend(message);
        setText("");
      }}
    />
  );
}
