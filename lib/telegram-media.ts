import { Buffer } from "node:buffer";

export const MAX_RECEIPT_IMAGE_BYTES = 20 * 1024 * 1024;

export type TelegramImageFile = { file_id: string; file_size?: number };
export type TelegramDocument = TelegramImageFile & { file_name?: string; mime_type?: string };

export class ReceiptImageError extends Error {
  constructor(public readonly code: "too_large" | "unsupported_format" | "download_failed") {
    super(code);
    this.name = "ReceiptImageError";
  }
}

export function selectReceiptImage(message: { photo?: TelegramImageFile[]; document?: TelegramDocument }): TelegramImageFile | null {
  if (message.photo?.length) return message.photo[message.photo.length - 1];
  const document = message.document;
  if (!document) return null;
  const mime = document.mime_type?.toLowerCase();
  const supportedMime = mime === "image/jpeg" || mime === "image/png" || mime === "image/webp";
  const supportedName = /\.(jpe?g|png|webp)$/i.test(document.file_name ?? "");
  return supportedMime || supportedName ? document : null;
}

function isSupportedImage(image: Buffer) {
  const jpeg = image.length >= 3 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff;
  const png = image.length >= 8 && image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp = image.length >= 12 && image.toString("ascii", 0, 4) === "RIFF" && image.toString("ascii", 8, 12) === "WEBP";
  return jpeg || png || webp;
}

export async function downloadReceiptImage(token: string, file: TelegramImageFile, fetcher: typeof fetch = fetch) {
  if ((file.file_size ?? 0) > MAX_RECEIPT_IMAGE_BYTES) throw new ReceiptImageError("too_large");
  const metadataResponse = await fetcher(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(file.file_id)}`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!metadataResponse.ok) throw new ReceiptImageError("download_failed");
  const metadata = await metadataResponse.json() as { ok?: boolean; result?: { file_path?: string; file_size?: number } };
  const filePath = metadata.result?.file_path;
  if (!metadata.ok || typeof filePath !== "string" || !filePath) throw new ReceiptImageError("download_failed");
  if ((metadata.result?.file_size ?? 0) > MAX_RECEIPT_IMAGE_BYTES) throw new ReceiptImageError("too_large");

  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  const response = await fetcher(`https://api.telegram.org/file/bot${token}/${encodedPath}`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok || !response.body) throw new ReceiptImageError("download_failed");
  if (Number(response.headers.get("content-length")) > MAX_RECEIPT_IMAGE_BYTES) {
    await response.body.cancel();
    throw new ReceiptImageError("too_large");
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RECEIPT_IMAGE_BYTES) {
        await reader.cancel();
        throw new ReceiptImageError("too_large");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  const image = Buffer.concat(chunks, size);
  // Telegram may serve documents as application/octet-stream; inspect bytes instead.
  if (!isSupportedImage(image)) throw new ReceiptImageError("unsupported_format");
  return image;
}
