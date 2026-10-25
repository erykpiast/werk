import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Textarea } from "../components/ui/textarea";
import { dotOf, type SearchRow } from "../lib/card-search";
import { restoreDraft } from "../lib/draft";
import {
  type Chip,
  insertToken,
  removeToken,
  settleSend,
  tokenOf,
} from "../lib/image-chips";
import {
  cardMatches,
  commandMatches,
  insertChoice,
  type Word,
  wordAt,
} from "../lib/word-menu";

/** What the composer needs to take an image: the upload, and the address of a stored one. */
export type ImageSink = {
  upload(file: Blob): Promise<{ name: string } | { error: string }>;
  imageUrl(name: string): string;
};

/** What the composer needs for its menus: the command names the server holds, and the cards of the map. */
export type MenuSource = {
  commands(): Promise<string[]>;
  cards(): readonly SearchRow[];
};

const imagesOf = (files: FileList | null | undefined): File[] =>
  Array.from(files ?? []).filter((file) => file.type.startsWith("image/"));

/**
 * The composer. A draft that the last load stashed comes back once (#werk-client-reload).
 * Enter sends the message, and Shift+Enter starts a new line. A pasted or dropped image uploads at
 * once and shows as a chip with its token in the text. Enter waits while an upload runs
 * (#werk-chat-image-inline, #werk-shot-chip). A word that starts with / opens the command menu, and
 * one that starts with # opens the card search. Arrows move, Enter or Tab inserts, Escape closes
 * (#werk-chat-cmdmenu, #werk-hash-trigger).
 */
export function Composer({
  onSend,
  images,
  menu,
}: {
  onSend?: (text: string, images: string[]) => void;
  images?: ImageSink;
  menu?: MenuSource;
}) {
  const [text, setText] = useState(() => restoreDraft(sessionStorage));
  const [chips, setChips] = useState<Chip[]>([]);
  const [waiting, setWaiting] = useState(false);
  const [word, setWord] = useState<Word | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const [selected, setSelected] = useState(0);
  /** The word that Escape closed, until its start or trigger changes. */
  const [closed, setClosed] = useState<string | null>(null);
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

  const slashStart = word?.trigger === "/" ? word.start : null;
  // The command names are read each time a word that starts with a slash opens the menu.
  useEffect(() => {
    if (slashStart === null || !menu) return;
    let live = true;
    menu
      .commands()
      .then((got) => live && setNames(got))
      .catch(() => live && setNames([]));
    return () => {
      live = false;
    };
  }, [slashStart, menu]);

  const items: { key: string; label: string; row?: SearchRow }[] =
    !menu || !word || closed === `${word.trigger}${word.start}`
      ? []
      : word.trigger === "/"
        ? commandMatches(names, word.query).map((name) => ({
            key: name,
            label: name,
          }))
        : cardMatches(menu.cards(), word.query).map((row) => ({
            key: row.id,
            label: row.id,
            row,
          }));
  const menuOpen = items.length > 0;

  const track = (value: string, caretAt: number) => {
    const next = wordAt(value, caretAt);
    if (next?.start !== word?.start || next?.trigger !== word?.trigger) {
      setSelected(0);
    }
    setWord(next);
  };

  const choose = (index: number) => {
    const picked = items[index];
    if (!picked || !word) return;
    const placed = insertChoice(text, word, picked.key);
    caret.current = placed.caret;
    setText(placed.text);
    setWord(null);
  };

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
      {menuOpen && (
        <div
          data-slot="word-menu"
          role="listbox"
          aria-label={word?.trigger === "/" ? "Commands" : "Cards"}
        >
          {items.map((item, i) => {
            const dot = item.row ? dotOf(item.row) : null;
            return (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the textarea keeps the focus and takes the keys
              <div
                key={item.key}
                role="option"
                tabIndex={-1}
                aria-selected={i === selected}
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(i);
                }}
              >
                {dot && (
                  <span
                    data-slot="dot"
                    data-color={dot.color}
                    data-split={dot.split || undefined}
                  />
                )}
                <code>{`${word?.trigger}${item.label}`}</code>
                {item.row && (
                  <span data-slot="result-title">{item.row.title}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
      <Textarea
        ref={box}
        data-composer
        aria-label="Message"
        placeholder="Message the agent"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          track(event.target.value, event.target.selectionStart);
        }}
        onSelect={(event) =>
          track(event.currentTarget.value, event.currentTarget.selectionStart)
        }
        onPaste={(event) => {
          const files = imagesOf(event.clipboardData?.files);
          if (files.length === 0) return;
          event.preventDefault();
          take(files);
        }}
        onKeyDown={(event) => {
          if (menuOpen && !event.nativeEvent.isComposing) {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const step = event.key === "ArrowDown" ? 1 : items.length - 1;
              setSelected((now) => (now + step) % items.length);
              return;
            }
            if (event.key === "Enter" || event.key === "Tab") {
              event.preventDefault();
              choose(selected);
              return;
            }
            if (event.key === "Escape" && word) {
              event.preventDefault();
              setClosed(`${word.trigger}${word.start}`);
              return;
            }
          }
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
