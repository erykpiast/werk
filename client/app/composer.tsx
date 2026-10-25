import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Textarea } from "../components/ui/textarea";
import { restoreDraft } from "../lib/draft";
import {
  type Chip,
  insertToken,
  removeToken,
  settleSend,
  tokenOf,
} from "../lib/image-chips";

/** What the composer needs to take an image: the upload, and the address of a stored one. */
export type ImageSink = {
  upload(file: Blob): Promise<{ name: string } | { error: string }>;
  imageUrl(name: string): string;
};

const imagesOf = (files: FileList | null | undefined): File[] =>
  Array.from(files ?? []).filter((file) => file.type.startsWith("image/"));

/**
 * The composer. A draft that the last load stashed comes back once (#werk-client-reload).
 * Enter sends the message, and Shift+Enter starts a new line. A pasted or dropped image uploads at
 * once and shows as a chip with its token in the text. Enter waits while an upload runs
 * (#werk-chat-image-inline, #werk-shot-chip).
 */
export function Composer({
  onSend,
  images,
}: {
  onSend?: (text: string, images: string[]) => void;
  images?: ImageSink;
}) {
  const [text, setText] = useState(() => restoreDraft(sessionStorage));
  const [chips, setChips] = useState<Chip[]>([]);
  const [waiting, setWaiting] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<number | null>(null);
  const counter = useRef(0);

  // The caret goes after a token that was just inserted.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on each change of the text
  useLayoutEffect(() => {
    if (caret.current !== null) {
      box.current?.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  }, [text]);

  const send = () => {
    const settled = settleSend(text, chips);
    const message = settled.text.trim();
    if (message === "" || !onSend) return;
    onSend(message, settled.names);
    setText("");
    setChips([]);
  };

  const uploading = chips.some((chip) => chip.state === "uploading");
  // A send that waited goes out once the last upload has answered.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the uploads end
  useEffect(() => {
    if (waiting && !uploading) {
      setWaiting(false);
      send();
    }
  }, [waiting, uploading]);

  const take = (files: File[]) => {
    if (!images || files.length === 0) return;
    const start = box.current?.selectionStart ?? text.length;
    let next = text;
    let at = start;
    const added = files.map((file, i) => {
      const placed = insertToken(next, at, chips.length + i + 1);
      next = placed.text;
      at = placed.caret;
      return {
        file,
        chip: { id: `c${counter.current++}`, state: "uploading" } as Chip,
      };
    });
    caret.current = at;
    setText(next);
    setChips((all) => [...all, ...added.map((a) => a.chip)]);
    for (const { file, chip } of added) {
      void images
        .upload(file)
        .then((done) =>
          setChips((all) =>
            all.map((c) =>
              c.id !== chip.id
                ? c
                : "name" in done
                  ? { ...c, state: "ready", name: done.name }
                  : { ...c, state: "refused", reason: done.error },
            ),
          ),
        );
    }
  };

  const remove = (index: number) => {
    setChips((all) => all.filter((_, i) => i !== index));
    setText((now) => removeToken(now, index + 1));
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a drop target; the keyboard way is paste
    <div
      data-slot="composer"
      onDragOver={(event) => {
        if (images && event.dataTransfer?.types.includes("Files")) {
          event.preventDefault();
        }
      }}
      onDrop={(event) => {
        const files = imagesOf(event.dataTransfer?.files);
        if (files.length === 0) return;
        event.preventDefault();
        take(files);
      }}
    >
      {chips.length > 0 && (
        <ul data-slot="image-chips" aria-label="Attached images">
          {chips.map((chip, index) => (
            <li key={chip.id} data-slot="image-chip" data-state={chip.state}>
              <span data-slot="image-token">{tokenOf(index + 1)}</span>
              {chip.state === "uploading" && (
                <span
                  data-slot="spinner"
                  role="status"
                  aria-label="Uploading"
                />
              )}
              {chip.state === "ready" && chip.name !== undefined && images && (
                <img
                  src={images.imageUrl(chip.name)}
                  alt={tokenOf(index + 1)}
                />
              )}
              {chip.state === "refused" && (
                <span data-slot="image-reason" role="alert">
                  {chip.reason}
                </span>
              )}
              <button
                type="button"
                data-slot="image-remove"
                aria-label={`Remove ${tokenOf(index + 1)}`}
                onClick={() => remove(index)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <Textarea
        ref={box}
        data-composer
        aria-label="Message"
        placeholder="Message the agent"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onPaste={(event) => {
          const files = imagesOf(event.clipboardData?.files);
          if (files.length === 0) return;
          event.preventDefault();
          take(files);
        }}
        onKeyDown={(event) => {
          if (
            event.key !== "Enter" ||
            event.shiftKey ||
            event.nativeEvent.isComposing
          ) {
            return;
          }
          event.preventDefault();
          if (uploading) setWaiting(true);
          else send();
        }}
      />
    </div>
  );
}
