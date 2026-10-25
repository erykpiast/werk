/**
 * The rules for a pasted image: which types the server takes, how big one may be, which file name
 * is a stored image, and the lines that tell the agent where each image is (#werk-shots,
 * #werk-shot-chip, #werk-chat-image-inline).
 */

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export type ImageType = "png" | "jpeg" | "gif" | "webp";

export const IMAGE_MIME: Record<ImageType, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

const EXTENSION: Record<ImageType, string> = {
  png: "png",
  jpeg: "jpg",
  gif: "gif",
  webp: "webp",
};

const startsWith = (bytes: Uint8Array, signature: readonly number[], at = 0) =>
  signature.every((byte, i) => bytes[at + i] === byte);

/** The image type that the first bytes show, or null for any other content. */
export function sniffImage(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "png";
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "gif";
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "webp";
  }
  return null;
}

export type ImageCheck =
  | { ok: true; type: ImageType }
  | { ok: false; status: 400 | 413 | 415; message: string };

/** Judges an upload by its size and its first bytes. */
export function checkImage(bytes: Uint8Array): ImageCheck {
  if (bytes.byteLength === 0) {
    return { ok: false, status: 400, message: "the image is empty" };
  }
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      status: 413,
      message: `the image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB`,
    };
  }
  const type = sniffImage(bytes);
  if (type === null) {
    return {
      ok: false,
      status: 415,
      message: "only PNG, JPEG, GIF and WebP images are taken",
    };
  }
  return { ok: true, type };
}

/** The name of a stored image: the time it was stored, a random part and the extension. */
export function imageFileName(type: ImageType, at: Date, random: string) {
  const stamp = at.toISOString().replace(/[-:.]/g, "").replace("T", "-");
  return `${stamp}-${random}.${EXTENSION[type]}`;
}

const STORED_NAME = /^[0-9]{8}-[0-9]{9}Z-[0-9a-f]{8}\.(png|jpg|gif|webp)$/;

/** True when the name has the form of a stored image. It can name no folder and no other file. */
export function isStoredName(name: string): boolean {
  return STORED_NAME.test(name);
}

/** The content type that a stored name serves with, or null for a name that is no stored image. */
export function mimeOfName(name: string): string | null {
  const found = STORED_NAME.exec(name);
  if (!found) return null;
  const type = (Object.keys(EXTENSION) as ImageType[]).find(
    (t) => EXTENSION[t] === found[1],
  );
  return type ? IMAGE_MIME[type] : null;
}

/** The lines that put the images before the message: each token with its path, then the order to read. */
export function imageHeader(paths: readonly string[]): string {
  if (paths.length === 0) return "";
  const lines = paths.map((path, i) => `[Image #${i + 1}] = ${path}`);
  return `${lines.join("\n")}\n\nOpen each image above with Read before you answer.`;
}
