const assert = require("node:assert/strict");
const { test } = require("node:test");
const { NextResponse } = require("next/server");
const loadTypeScript = require("./helpers/load-typescript.cjs");
const media = loadTypeScript("lib/telegram-media.ts");
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const jpeg = Buffer.from([255, 216, 255, 224]);
const webp = Buffer.from("RIFF0000WEBP");

function downloads(image, headers = {}) {
  const calls = [];
  return {
    calls,
    fetcher: async url => {
      calls.push(String(url));
      return calls.length === 1
        ? Response.json({ ok: true, result: { file_path: "documents/receipt.jpg" } })
        : new Response(image, { headers });
    },
  };
}

test("selects the largest Telegram photo and keeps its size", () => {
  const photo = media.selectReceiptImage({ photo: [{ file_id: "small" }, { file_id: "large", file_size: 1234 }] });
  assert.equal(photo.file_id, "large");
  assert.equal(photo.file_size, 1234);
});

test("accepts images.jpg sent as a document, including generic MIME types", () => {
  for (const document of [
    { file_id: "image", file_name: "images.jpg", mime_type: "image/jpeg" },
    { file_id: "image", file_name: "RECEIPT.JPG", mime_type: "application/octet-stream" },
    { file_id: "image", mime_type: "image/png" },
    { file_id: "image", file_name: "receipt.webp" },
  ]) assert.equal(media.selectReceiptImage({ document }).file_id, "image");
});

test("rejects PDFs and unrelated attachments instead of treating them as receipts", () => {
  assert.equal(media.selectReceiptImage({ document: { file_id: "pdf", file_name: "receipt.pdf", mime_type: "application/pdf" } }), null);
  assert.equal(media.selectReceiptImage({ document: { file_id: "zip", file_name: "images.jpg.zip" } }), null);
  assert.equal(media.selectReceiptImage({}), null);
});

test("downloads JPEG, PNG, and WebP based on content even with octet-stream headers", async () => {
  for (const bytes of [jpeg, png, webp]) {
    const mock = downloads(bytes, { "content-type": "application/octet-stream" });
    const result = await media.downloadReceiptImage("test-token", { file_id: "document/id" }, mock.fetcher);
    assert.ok(result.equals(bytes));
    assert.ok(mock.calls[0].includes("file_id=document%2Fid"));
    assert.equal(mock.calls.length, 2);
  }
});

test("does not accept a PDF renamed to JPG or an empty image response", async () => {
  for (const bytes of [Buffer.from("%PDF-1.7"), Buffer.alloc(0)]) {
    await assert.rejects(media.downloadReceiptImage("test-token", { file_id: "renamed" }, downloads(bytes).fetcher), error => error.code === "unsupported_format");
  }
});

test("rejects oversized document metadata before downloading", async () => {
  let calls = 0;
  await assert.rejects(media.downloadReceiptImage("test-token", { file_id: "large", file_size: media.MAX_RECEIPT_IMAGE_BYTES + 1 }, async () => { calls++; }), error => error.code === "too_large");
  assert.equal(calls, 0);
  await assert.rejects(media.downloadReceiptImage("test-token", { file_id: "large" }, async () => Response.json({ ok: true, result: { file_path: "large.jpg", file_size: media.MAX_RECEIPT_IMAGE_BYTES + 1 } })), error => error.code === "too_large");
});

test("enforces the byte limit while streaming when file size headers are missing", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(Buffer.alloc(media.MAX_RECEIPT_IMAGE_BYTES));
      controller.enqueue(Buffer.from([1]));
    },
    cancel() { cancelled = true; },
  });
  await assert.rejects(media.downloadReceiptImage("test-token", { file_id: "large" }, downloads(stream).fetcher), error => error.code === "too_large");
  assert.equal(cancelled, true);
});

test("handles Telegram download errors without passing data to OCR", async () => {
  await assert.rejects(media.downloadReceiptImage("test-token", { file_id: "missing" }, async () => Response.json({ ok: false }, { status: 404 })), error => error.code === "download_failed");
});

async function runWebhook(message) {
  const sent = [];
  const writes = [];
  let recognized = 0;
  const fetcher = async (url, options) => {
    if (String(url).endsWith("/sendMessage")) {
      sent.push(JSON.parse(options.body));
      return Response.json({ ok: true });
    }
    if (String(url).includes("/getFile?")) return Response.json({ ok: true, result: { file_path: "documents/images.jpg" } });
    return new Response(jpeg, { headers: { "content-type": "application/octet-stream" } });
  };
  const admin = {
    from(table) {
      const query = {
        delete() { return query; }, lt() { return Promise.resolve({ error: null }); },
        select() { return query; }, eq() { return query; },
        maybeSingle() { return Promise.resolve({ data: table === "telegram_connections" ? { user_id: "test-user" } : null }); },
        insert(data) { writes.push({ table, data }); return query; },
        single() { return Promise.resolve({ data: { id: "00000000-0000-0000-0000-000000000001", merchant: "TEST SHOP", amount: 25000, transaction_date: "2026-10-26", confidence: 90 }, error: null }); },
      };
      return query;
    },
  };
  const isolatedMedia = loadTypeScript("lib/telegram-media.ts", { globals: { fetch: fetcher } });
  const route = loadTypeScript("app/api/telegram/webhook/route.ts", {
    modules: {
      "next/server": { NextResponse },
      "@/lib/telegram-media": isolatedMedia,
      "@/lib/supabase/admin": { createAdminClient: () => admin },
      "@/lib/receipts/ocr": { recognizeReceipt: async () => { recognized++; return { merchant: "TEST SHOP", amount: 25000, date: "2026-10-26", confidence: 90 }; } },
    },
    globals: { fetch: fetcher, process: { env: { TELEGRAM_BOT_TOKEN: "test-token", TELEGRAM_WEBHOOK_SECRET: "test-secret" } } },
  });
  const response = await route.POST(new Request("https://saku.example/api/telegram/webhook", {
    method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "test-secret" },
    body: JSON.stringify({ update_id: 123, message: { chat: { id: 1, type: "private" }, ...message } }),
  }));
  return { response, sent, writes, recognized };
}

test("webhook processes both a Telegram photo and an images.jpg document through the confirmation flow", async () => {
  for (const message of [
    { photo: [{ file_id: "photo" }] },
    { document: { file_id: "document", file_name: "images.jpg", mime_type: "image/jpeg" } },
  ]) {
    const result = await runWebhook(message);
    assert.equal(result.response.status, 200);
    assert.equal(result.recognized, 1);
    assert.equal(result.writes.length, 1);
    assert.equal(result.writes[0].table, "pending_receipts");
    assert.ok(result.sent.some(reply => reply.reply_markup?.inline_keyboard[0][0].text === "Simpan transaksi"));
    assert.ok(!result.sent.some(reply => reply.text.includes("belum mengenali perintah")));
  }
});

test("webhook gives unsupported documents a format hint and makes no receipt or transaction", async () => {
  const result = await runWebhook({ document: { file_id: "pdf", file_name: "receipt.pdf", mime_type: "application/pdf" } });
  assert.equal(result.response.status, 200);
  assert.equal(result.recognized, 0);
  assert.equal(result.writes.length, 0);
  assert.ok(result.sent[0].text.includes("Format file belum didukung"));
});
