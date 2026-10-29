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

async function runWebhook(message, options = {}) {
  const sent = [];
  const writes = [];
  const answered = [];
  const rpcCalls = [];
  let recognized = 0;
  const fetcher = async (url, options) => {
    if (String(url).endsWith("/sendMessage")) {
      sent.push(JSON.parse(options.body));
      return Response.json({ ok: true });
    }
    if (String(url).endsWith("/answerCallbackQuery")) {
      answered.push(JSON.parse(options.body));
      return Response.json({ ok: true });
    }
    if (String(url).includes("/getFile?")) return Response.json({ ok: true, result: { file_path: "documents/images.jpg" } });
    return new Response(jpeg, { headers: { "content-type": "application/octet-stream" } });
  };
  const admin = {
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      if (name === "claim_receipt_job") return { data: { status: options.claim ?? "claimed", lease_id: options.claim && options.claim !== "claimed" ? null : "00000000-0000-0000-0000-000000000002" }, error: options.claimError ?? null };
      if (name === "finish_receipt_job") return { data: true, error: null };
      if (name === "confirm_pending_receipt") return { data: options.confirmStatus ?? "confirmed", error: null };
      if (name === "cancel_pending_receipt") return { data: options.cancelStatus ?? "cancelled", error: null };
      if (name === "post_telegram_journal") return { data: { status: options.postStatus ?? "posted" }, error: options.postError ?? null };
      if (name === "telegram_ledger_summary") return { data: { income: "8000000", expense: "500000", cash_in: "9000000", cash_out: "100000", accounts: [{ code: "2000", name: "Utang", account_type: "liability", role: "payable", balance: "750000" }] }, error: null };
      throw Error("Unexpected RPC " + name);
    },
    from(table) {
      const query = {
        delete() { return query; }, lt() { return Promise.resolve({ error: null }); },
        select() { return query; }, eq() { return query; },
        maybeSingle() { return Promise.resolve({ data: table === "telegram_connections" ? { user_id: "test-user" } : table === "transactions" ? options.existingTransaction ?? null : null }); },
        insert(data) { writes.push({ table, data }); return query; },
        then(resolve, reject) { return Promise.resolve({ error: table === "transactions" && options.transactionConflict ? { code: "23505" } : null }).then(resolve, reject); },
        single() { return Promise.resolve({ data: { id: "00000000-0000-0000-0000-000000000001", merchant: "TEST SHOP", amount: 25000, transaction_date: "2026-10-26", confidence: 90 }, error: null }); },
      };
      return query;
    },
  };
  const isolatedMedia = loadTypeScript("lib/telegram-media.ts", { globals: { fetch: fetcher } });
  const route = loadTypeScript("app/api/telegram/webhook/route.ts", {
    modules: {
      "next/server": { NextResponse },
      "@/lib/telegram-media": { ...isolatedMedia, normalizeReceiptImage: async image => image },
      "@/lib/security-limits": { consumeSecurityLimits: async () => ({ allowed: options.securityAllowed !== false, retryAfter: 60 }) },
      "@/lib/money": loadTypeScript("lib/money.ts"),
      "@/lib/telegram-journal": loadTypeScript("lib/telegram-journal.ts", { modules: { "@/lib/money": loadTypeScript("lib/money.ts") } }),
      "@/lib/supabase/admin": { createAdminClient: () => admin },
      "@/lib/receipts/ocr": { ReceiptOcrBusyError: class extends Error {}, recognizeReceipt: async () => { recognized++; return options.candidate ?? { merchant: "TEST SHOP", amount: 25000, date: "2026-10-26", confidence: 90 }; } },
    },
    globals: { fetch: fetcher, process: { env: { TELEGRAM_BOT_TOKEN: "test-token", TELEGRAM_WEBHOOK_SECRET: "test-secret" } } },
  });
  const response = await route.POST(new Request("https://saku.example/api/telegram/webhook", {
    method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "test-secret" },
    body: JSON.stringify(options.callback ? { update_id: 123, callback_query: { id: "callback-test", message: { chat: { id: 1, type: "private" } }, ...options.callback } } : { update_id: 123, message: { chat: { id: 1, type: "private" }, ...message } }),
  }));
  return { response, sent, writes, recognized, rpcCalls, answered };
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
    assert.ok(result.rpcCalls.some(call => call.name === "claim_receipt_job"));
    assert.ok(result.rpcCalls.some(call => call.name === "finish_receipt_job"));
  }
});

test("duplicate OCR updates never start a worker or create another receipt", async () => {
  const result = await runWebhook({ photo: [{ file_id: "photo" }] }, { claim: "duplicate" });
  assert.equal(result.response.status, 200);
  assert.equal(result.recognized, 0);
  assert.equal(result.writes.length, 0);
  assert.equal(result.sent.length, 0);
});

test("transfer proof never enters cash-expense confirmation and always releases its job", async () => {
  const result = await runWebhook({ photo: [{ file_id: "proof" }] }, { candidate: { kind: "bank_transfer", merchant: "Transfer ke TEST RECIPIENT", amount: 11000, date: "2026-10-29", confidence: 88, issue: null } });
  assert.equal(result.response.status, 200); assert.equal(result.writes.length, 0);
  assert.ok(result.sent.some(reply => reply.text.includes('/jurnal 5000 1010 11000 @2026-10-29')));
  assert.ok(!result.sent.some(reply => reply.reply_markup));
  assert.ok(result.rpcCalls.some(call => call.name === "finish_receipt_job"));
});

test("dated manual journals use the proof date instead of today's date", async () => {
  const result = await runWebhook({ text: "/jurnal 5000 1010 11000 @2026-10-29 Test purchase" });
  const posting = result.rpcCalls.find(call => call.name === "post_telegram_journal");
  assert.equal(posting.args.p_entry_date, "2026-10-29"); assert.equal(posting.args.p_memo, "Test purchase");
  const invalid = await runWebhook({ text: "/jurnal 5000 1010 11000 @2026-02-30 Test purchase" });
  assert.ok(!invalid.rpcCalls.some(call => call.name === "post_telegram_journal"));
});

test("busy, revoked, and over-quota receipt jobs are rejected before downloads and OCR", async () => {
  for (const claim of ["busy", "unlinked", "rate_limited"]) {
    const result = await runWebhook({ photo: [{ file_id: "photo" }] }, { claim });
    assert.equal(result.response.status, 200);
    assert.equal(result.recognized, 0);
    assert.equal(result.writes.length, 0);
    assert.equal(result.sent.length, 1);
  }
});

test("receipt job protection fails closed when the database function is unavailable", async () => {
  const result = await runWebhook({ photo: [{ file_id: "photo" }] }, { claimError: { message: "migration missing" } });
  assert.equal(result.response.status, 503);
  assert.equal(result.recognized, 0);
  assert.equal(result.writes.length, 0);
});

test("receipt callback cannot report a database collision as a successful save", async () => {
  const result = await runWebhook({}, { callback: { data: "receipt:save:00000000-0000-0000-0000-000000000001" }, confirmStatus: "conflict" });
  assert.equal(result.response.status, 200);
  assert.equal(result.sent.length, 0);
  assert.ok(result.answered[0].text.includes("belum disimpan"));
});

test("text transaction collisions cannot be reported as the owner's saved message", async () => {
  const result = await runWebhook({ text: "/catat pengeluaran 25000 Makanan makan siang" }, { transactionConflict: true });
  assert.equal(result.response.status, 200);
  assert.ok(result.sent[0].text.includes("belum tersimpan"));
  const duplicate = await runWebhook({ text: "/catat pengeluaran 25000 Makanan makan siang" }, { transactionConflict: true, existingTransaction: { id: "own-existing" } });
  assert.ok(duplicate.sent[0].text.includes("sudah pernah dicatat"));
});

test("cancel uses the atomic authorization RPC and rejects a revoked receipt button", async () => {
  const result = await runWebhook({}, { callback: { data: "receipt:cancel:00000000-0000-0000-0000-000000000001" }, cancelStatus: "invalid" });
  assert.equal(result.sent.length, 0);
  assert.ok(result.rpcCalls.some(call => call.name === "cancel_pending_receipt"));
  assert.ok(result.answered[0].text.includes("koneksi sudah berubah"));
  assert.equal(result.writes.length, 0);
});

test("webhook gives unsupported documents a format hint and makes no receipt or transaction", async () => {
  const result = await runWebhook({ document: { file_id: "pdf", file_name: "receipt.pdf", mime_type: "application/pdf" } });
  assert.equal(result.response.status, 200);
  assert.equal(result.recognized, 0);
  assert.equal(result.writes.length, 0);
  assert.ok(result.sent[0].text.includes("Format file belum didukung"));
});

test("bot stores 30ribu as 30000 and rejects unknown amount suffixes before any posting", async () => {
  const valid = await runWebhook({ text: "/catat pengeluaran 30ribu Administrasi Buat SKCK" });
  assert.equal(valid.writes[0].data.amount, 30000);
  const invalid = await runWebhook({ text: "/catat pengeluaran 30abc Administrasi Buat SKCK" });
  assert.equal(invalid.writes.length, 0);
  assert.ok(invalid.sent[0].text.includes("Nominal belum valid"));
});
test("debt and manual journal messages post through the current-chat RPC with explicit accounts", async () => {
  for (const [text, debit, credit] of [["/catat utang 1jt Pinjaman Dari Budi", "1000", "2000"], ["/jurnal 1010 2010 1jt Pinjaman Budi", "1010", "2010"]]) {
    const result = await runWebhook({ text });
    const rpc = result.rpcCalls.find(call => call.name === "post_telegram_journal");
    assert.equal(rpc.args.p_chat_id, 1); assert.equal(rpc.args.p_debit_code, debit); assert.equal(rpc.args.p_credit_code, credit); assert.equal(rpc.args.p_amount, 1000000);
    assert.equal(result.writes.length, 0); assert.ok(result.sent[0].text.includes("Jurnal tersimpan"));
  }
});
test("journal posting errors, unknown accounts, and revoked connections never acknowledge a save", async () => {
  for (const options of [{ postError: { message: "migration unavailable" } }, { postStatus: "invalid_account" }, { postStatus: "unlinked" }, { postStatus: "conflict" }]) {
    const result = await runWebhook({ text: "/catat piutang 30rb Pinjaman Budi" }, options);
    assert.ok(!result.sent.some(reply => reply.text.includes("Jurnal tersimpan")));
  }
});
test("monthly bot summary reads journal accounting instead of legacy income and expense rows", async () => {
  const result = await runWebhook({ text: "/ringkasan" });
  assert.ok(result.rpcCalls.some(call => call.name === "telegram_ledger_summary"));
  assert.ok(result.sent[0].text.includes("Pendapatan:")); assert.ok(result.sent[0].text.includes("Kas masuk:"));
  const accounts = await runWebhook({ text: "/utang" }); assert.ok(accounts.sent[0].text.includes("2000 Utang"));
});

test("salary command preserves 3681341.75 as exact decimal text through storage and confirmation", async () => {
  const result = await runWebhook({ text: "/catat pemasukan 3681341.75 gaji gaji bulanan" });
  assert.equal(result.writes[0].data.amount, "3681341.75");
  assert.match(result.sent[0].text, /3\.681\.341,75/);
  const rejected = await runWebhook({ text: "/catat pemasukan 3681341.751 gaji gaji bulanan" });
  assert.equal(rejected.writes.length, 0);
  assert.match(rejected.sent[0].text, /maksimal dua desimal/);
  const journal = await runWebhook({ text: "/jurnal 1010 4000 3681341.75 Gaji bank" });
  assert.equal(journal.rpcCalls.find(call => call.name === "post_telegram_journal").args.p_amount, "3681341.75");
  assert.match(journal.sent[0].text, /3\.681\.341,75/);
});
