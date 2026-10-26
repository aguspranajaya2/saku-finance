import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorker } from "tesseract.js";
import { parseReceipt } from "@/lib/receipts/parse";

export async function recognizeReceipt(image: Buffer) {
  const cachePath = join(tmpdir(), "saku-tesseract-cache");

  type OcrWorker = Awaited<ReturnType<typeof createWorker>>;
  let worker: OcrWorker | undefined;
  let finished = false;
  let rejectFailure!: (error: Error) => void;
  const failure = new Promise<never>((_, reject) => { rejectFailure = reject; });
  // Initialization can report an error before the first Promise.race is attached.
  void failure.catch(() => {});
  const failedError = new Error("Receipt OCR failed.");
  const timeoutError = new Error("Receipt OCR timed out.");
  const deadline = setTimeout(() => rejectFailure(timeoutError), 45_000);

  async function stopWorker(created: OcrWorker) {
    try {
      await created.terminate();
    } catch {
      // Cleanup must not replace a successful result or the original OCR failure.
    }
  }

  try {
    await Promise.race([mkdir(cachePath, { recursive: true }), failure]);
    const initialization = createWorker(["ind", "eng"], 1, {
      cachePath,
      // Tesseract otherwise throws from its message callback outside this try/catch.
      errorHandler: () => rejectFailure(failedError),
    });
    void initialization.then((created) => {
      if (finished) {
        // Initialization may complete after our deadline or an initialization error.
        void stopWorker(created);
      } else {
        worker = created;
      }
    }, () => {});

    worker = await Promise.race([initialization, failure]);
    const { data } = await Promise.race([worker.recognize(image), failure]);
    return parseReceipt(data.text, data.confidence);
  } catch (error) {
    // Worker errors can contain OCR text or paths; expose only fixed messages.
    throw error === timeoutError ? timeoutError : failedError;
  } finally {
    finished = true;
    clearTimeout(deadline);
    if (worker) await stopWorker(worker);
  }
}
