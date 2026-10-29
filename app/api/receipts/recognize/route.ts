import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { consumeSecurityLimits } from "@/lib/security-limits";
import { recognizeReceipt, ReceiptOcrBusyError } from "@/lib/receipts/ocr";
import { MAX_RECEIPT_IMAGE_BYTES, normalizeReceiptImage, ReceiptImageError } from "@/lib/telegram-media";

export const runtime = "nodejs";
export const maxDuration = 120;
// Vercel's request-body limit also applies; use a smaller upload on the web.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
function reply(value: object, status = 200) {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
}
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") return reply({ error: "forbidden" }, 403);
  if (!/^image\/(jpeg|png|webp)(?:;|$)/i.test(request.headers.get("content-type") ?? "")) return reply({ error: "unsupported_format" }, 415);
  try {
    const client = await createClient();
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return reply({ error: "unauthorized" }, 401);
    const allowance = await consumeSecurityLimits(createAdminClient(), [
      { scope: "web-receipt-minute", value: data.user.id, limit: 3, windowSeconds: 60 },
      { scope: "web-receipt-day", value: data.user.id, limit: 20, windowSeconds: 86400 },
      { scope: "web-receipt-global-minute", value: "ocr", limit: 10, windowSeconds: 60 },
    ]);
    if (!allowance.allowed) return reply({ error: "rate_limited" }, 429);
    if (Number(request.headers.get("content-length")) > MAX_UPLOAD_BYTES) return reply({ error: "too_large" }, 413);
    if (!request.body) return reply({ error: "invalid_image" }, 400);
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > Math.min(MAX_UPLOAD_BYTES, MAX_RECEIPT_IMAGE_BYTES)) {
          await reader.cancel();
          return reply({ error: "too_large" }, 413);
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const candidate = await recognizeReceipt(await normalizeReceiptImage(Buffer.concat(chunks)));
    return reply({ candidate }); // Only the draft, never the OCR text or image.
  } catch (error) {
    if (error instanceof ReceiptImageError) return reply({ error: error.code }, 400);
    if (error instanceof ReceiptOcrBusyError) return reply({ error: "busy" }, 429);
    return reply({ error: "unavailable" }, 503);
  }
}
