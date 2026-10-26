import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorker } from "tesseract.js";
import { parseReceipt } from "@/lib/receipts/parse";

export async function recognizeReceipt(image: Buffer) {
  const cachePath = join(tmpdir(), "saku-tesseract-cache");
  await mkdir(cachePath, { recursive: true });
  const worker = await createWorker(["ind", "eng"], 1, { cachePath });

  try {
    const { data } = await worker.recognize(image);
    return parseReceipt(data.text, data.confidence);
  } finally {
    await worker.terminate();
  }
}
