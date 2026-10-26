import { Buffer } from "node:buffer";
import sharp from "sharp";

export const MAX_RECEIPT_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_RECEIPT_IMAGE_PIXELS = 20_000_000;
export const MAX_RECEIPT_IMAGE_DIMENSION = 10_000;

export type TelegramImageFile = { file_id: string; file_size?: number };
export type TelegramDocument = TelegramImageFile & { file_name?: string; mime_type?: string };

export class ReceiptImageError extends Error {
  constructor(public readonly code: "too_large" | "unsupported_format" | "download_failed" | "too_many_pixels" | "invalid_image") {
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

function isAnimatedPng(image: Buffer) {
  if (image.toString("ascii", 1, 4) !== "PNG") return false;
  let offset = 8;
  while (offset + 12 <= image.length) {
    const length = image.readUInt32BE(offset);
    if (image.toString("ascii", offset + 4, offset + 8) === "acTL") return true;
    if (length > image.length - offset - 12) break;
    offset += length + 12;
  }
  return false;
}

/** Fully decode bounded, single-frame input before passing any image to OCR. */
export async function normalizeReceiptImage(image: Buffer): Promise<Buffer> {
  if (image.length > MAX_RECEIPT_IMAGE_BYTES) throw new ReceiptImageError("too_large");
  if (!isSupportedImage(image)) throw new ReceiptImageError("unsupported_format");
  // libvips reads only the first frame of APNG; reject its animation control chunk.
  if (isAnimatedPng(image)) throw new ReceiptImageError("invalid_image");

  try {
    const decoder = sharp(image, {
      limitInputPixels: MAX_RECEIPT_IMAGE_PIXELS,
      limitInputChannels: 4,
      failOn: "error",
      sequentialRead: true,
      animated: false,
    });
    const metadata = await decoder.metadata();
    if (!["jpeg", "png", "webp"].includes(metadata.format) || (metadata.pages ?? 1) !== 1) {
      throw new ReceiptImageError("invalid_image");
    }
    const { width, height } = metadata;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
      throw new ReceiptImageError("invalid_image");
    }
    if (width > MAX_RECEIPT_IMAGE_DIMENSION || height > MAX_RECEIPT_IMAGE_DIMENSION || width * height > MAX_RECEIPT_IMAGE_PIXELS) {
      throw new ReceiptImageError("too_many_pixels");
    }

    const normalized = await decoder
      .rotate()
      .resize({ width: 2500, height: 6000, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .toColourspace("srgb")
      .png({ compressionLevel: 6 })
      .timeout({ seconds: 10 })
      .toBuffer();
    if (normalized.length > MAX_RECEIPT_IMAGE_BYTES) throw new ReceiptImageError("too_large");
    return normalized;
  } catch (error) {
    if (error instanceof ReceiptImageError) throw error;
    if (error && typeof error === "object" && "message" in error && typeof error.message === "string" && /pixel limit/i.test(error.message)) {
      throw new ReceiptImageError("too_many_pixels");
    }
    // Native decoder messages can contain input details; expose only fixed codes.
    throw new ReceiptImageError("invalid_image");
  }
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
