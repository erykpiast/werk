import { type Page } from "@playwright/test";

export type Shot = {
  /** "png" or "jpeg" */
  type: "png" | "jpeg";
  /** A color so that two shots have different bytes. */
  color: string;
  /** Pad the file with zero bytes to this many bytes (a PNG ignores bytes after its end). */
  size?: number;
};

const SCRIPT = ({
  shot: { type, color, size },
  mode,
}: {
  shot: Shot;
  mode: "paste" | "drop";
}) => {
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 8;
  const g = canvas.getContext("2d") as CanvasRenderingContext2D;
  g.fillStyle = color;
  g.fillRect(0, 0, 8, 8);
  return new Promise<void>((done) => {
    canvas.toBlob(
      async (blob) => {
        const base = new Uint8Array(await (blob as Blob).arrayBuffer());
        const bytes = new Uint8Array(Math.max(size ?? 0, base.length));
        bytes.set(base);
        const transfer = new DataTransfer();
        transfer.items.add(
          new File([bytes], type === "png" ? "shot.png" : "shot.jpg", {
            type: type === "png" ? "image/png" : "image/jpeg",
          }),
        );
        const target =
          mode === "paste"
            ? (document.querySelector("textarea") as HTMLElement)
            : (document.querySelector("[data-slot=composer]") as HTMLElement);
        const event =
          mode === "paste"
            ? new ClipboardEvent("paste", {
                clipboardData: transfer,
                bubbles: true,
                cancelable: true,
              })
            : new DragEvent("drop", {
                dataTransfer: transfer,
                bubbles: true,
                cancelable: true,
              });
        target.dispatchEvent(event);
        done();
      },
      type === "png" ? "image/png" : "image/jpeg",
    );
  });
};

/** Pastes one image as a clipboard with one file. The textarea keeps its caret. */
export async function pasteImage(page: Page, shot: Shot) {
  await page.getByRole("textbox", { name: "Message" }).focus();
  await page.evaluate(SCRIPT, { shot, mode: "paste" });
}

/** Drops one image on the composer. */
export async function dropImage(page: Page, shot: Shot) {
  await page.evaluate(SCRIPT, { shot, mode: "drop" });
}
