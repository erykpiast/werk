import { useState } from "react";
import { Textarea } from "../components/ui/textarea";
import { restoreDraft } from "../lib/draft";

/** The composer. A draft that the last load stashed comes back once (#werk-client-reload). */
export function Composer() {
  const [text, setText] = useState(() => restoreDraft(sessionStorage));
  return (
    <Textarea
      data-composer
      aria-label="Message"
      placeholder="Message the agent"
      value={text}
      onChange={(event) => setText(event.target.value)}
    />
  );
}
