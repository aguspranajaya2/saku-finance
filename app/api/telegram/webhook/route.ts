import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { recognizeReceipt, ReceiptOcrBusyError } from "@/lib/receipts/ocr";
import { createAdminClient } from "@/lib/supabase/admin";
import { downloadReceiptImage, normalizeReceiptImage, ReceiptImageError, selectReceiptImage, type TelegramDocument, type TelegramImageFile } from "@/lib/telegram-media";
import { consumeSecurityLimits } from "@/lib/security-limits";
import { exactRupiah, formatRupiah, validRupiah } from "@/lib/money";
import { parseTelegramJournal } from "@/lib/telegram-journal";

export const runtime = "nodejs";
export const maxDuration = 120;

type TelegramMessage = {
  chat: { id: number; type: string };
  text?: string;
  photo?: TelegramImageFile[];
  document?: TelegramDocument;
};

type TelegramCallbackQuery = {
  id: string;
  data?: string;
  message?: { chat: { id: number; type: string } };
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

type TelegramReplyMarkup = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

type PendingReceipt = {
  id: string;
  merchant: string;
  amount: number | string;
  transaction_date: string;
  date_was_defaulted: boolean;
  confidence: number | string;
};

async function sendMessage(token: string, chatId: number, text: string, replyMarkup?: TelegramReplyMarkup) {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }),
  });
  if (!response.ok) throw new Error("Telegram message could not be delivered.");
}

async function answerCallback(token: string, callbackId: string, text: string) {
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackId, text }),
  });
}

function receiptPreview(receipt: PendingReceipt) {
  const amount = formatRupiah(receipt.amount);
  const date = new Date(`${receipt.transaction_date}T12:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Makassar" });
  const confidence = Math.round(Number(receipt.confidence));
  const dateNote = receipt.date_was_defaulted ? " (tanggal default hari ini)" : "";
  const confidenceNote = confidence < 55 ? "\nHasil OCR kurang jelas, periksa nominal dengan teliti." : "";
  return `Periksa hasil baca struk:\nToko: ${receipt.merchant}\nTotal: ${amount}\nTanggal: ${date}${dateNote}\nAkurasi teks: ${confidence}%${confidenceNote}\n\nPembayaran: Kas (debit 5000, kredit 1000). Untuk bank/kartu kredit atau koreksi nominal, tekan Batal lalu gunakan /catat atau /jurnal.`;
}

function makassarDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Makassar",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function monthRange(date: string) {
  const [year, month] = date.split("-").map(Number);
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextMonth = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
  return { start, end: `${nextMonth}-01` };
}

const helpText = [
  "Perintah Saku:",
  "/catat pengeluaran 25000 Makanan makan siang",
  "/catat pemasukan 3000000 Gaji gaji bulanan",
  "/catat utang 1jt Pinjaman pinjam uang",
  "/catat piutang 300rb Pinjaman pinjamkan uang",
  "/catat bayar_utang 100rb Cicilan bayar pokok",
  "/catat terima_piutang 50rb Pinjaman terima angsuran",
  "/catat kartu_debit 30rb Makanan makan siang",
  "/catat kartu_kredit 200rb Belanja belanja kartu",
  "/catat bayar_kartu 100rb Cicilan bayar kartu dari Bank",
  "/catat transfer 100rb Transfer Kas ke Bank",
  "/catat modal 1jt Modal setoran modal",
  "/catat prive 100rb Modal penarikan pribadi",
  "/jurnal 1010 2000 1jt Pinjaman masuk Bank (kode debit, kredit, nominal, keterangan)",
  "/akun — kode akun dan saldo; /utang; /piutang",
  "/ringkasan — ringkasan bulan ini",
  "/help — bantuan",
  "Kirim foto struk atau file gambar JPG/PNG/WebP (maks. 20 MB).",
].join("\n");

export async function POST(request: Request) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!token || !webhookSecret) {
    return NextResponse.json({ error: "Telegram belum dikonfigurasi." }, { status: 503 });
  }
  const suppliedSecret = Buffer.from(request.headers.get("x-telegram-bot-api-secret-token") ?? "");
  const expectedSecret = Buffer.from(webhookSecret);
  if (suppliedSecret.length !== expectedSecret.length || !timingSafeEqual(suppliedSecret, expectedSecret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ error: "Invalid update." }, { status: 400 });
  }
  if (!update || !Number.isSafeInteger(update.update_id) || update.update_id < 0) {
    return NextResponse.json({ error: "Invalid update." }, { status: 400 });
  }

  const message = update.message;
  const callback = update.callback_query;
  const chat = message?.chat ?? callback?.message?.chat;
  if (!chat || chat.type !== "private") return NextResponse.json({ ok: true });

  let admin;
  try {
    admin = createAdminClient();
    const allowance = await consumeSecurityLimits(admin, [{ scope: "telegram-chat-minute", value: String(chat.id), limit: 30, windowSeconds: 60 }]);
    if (!allowance.allowed) {
      if (callback) await answerCallback(token, callback.id, "Terlalu banyak permintaan. Coba lagi sebentar.");
      else await sendMessage(token, chat.id, "Terlalu banyak permintaan. Coba lagi sebentar.");
      return NextResponse.json({ ok: true });
    }
  } catch {
    return NextResponse.json({ error: "Security controls are temporarily unavailable." }, { status: 503 });
  }
  await admin.from("pending_receipts").delete().lt("expires_at", new Date().toISOString());

  if (callback) {
    const action = callback.data?.match(/^receipt:(save|cancel):([0-9a-f-]{36})$/i);
    if (!action || !callback.message) {
      await answerCallback(token, callback.id, "Tombol ini sudah tidak berlaku.");
      return NextResponse.json({ ok: true });
    }

    const receiptId = action[2];
    if (action[1] === "save") {
      const { data: result, error } = await admin.rpc("confirm_pending_receipt", {
        p_pending_receipt_id: receiptId,
        p_chat_id: callback.message.chat.id,
      });
      const statusValue = Array.isArray(result) ? result[0] : result;
      const status = typeof statusValue === "string" ? statusValue : "invalid";
      if (error || status !== "confirmed") {
        await answerCallback(token, callback.id, status === "conflict" ? "Struk belum disimpan karena benturan data. Coba kirim ulang." : "Struk kedaluwarsa, koneksi sudah berubah, atau sudah diproses.");
        return NextResponse.json({ ok: true });
      }
      await answerCallback(token, callback.id, "Transaksi tersimpan.");
      await sendMessage(token, callback.message.chat.id, "Transaksi struk berhasil disimpan ke Saku.");
      return NextResponse.json({ ok: true });
    }

    const { data: cancelStatus, error } = await admin.rpc("cancel_pending_receipt", {
      p_pending_receipt_id: receiptId,
      p_chat_id: callback.message.chat.id,
    });
    const cancelled = cancelStatus === "cancelled" && !error;
    await answerCallback(token, callback.id, cancelled ? "Dibatalkan." : "Struk kedaluwarsa, koneksi sudah berubah, atau sudah diproses.");
    if (cancelled) {
      await sendMessage(token, callback.message.chat.id, "Struk tidak disimpan. Untuk koreksi, catat nominal secara manual dengan /catat.");
    }
    return NextResponse.json({ ok: true });
  }

  if (!message) return NextResponse.json({ ok: true });

  const text = message.text?.trim() ?? "";
  const startMatch = text.match(/^\/start(?:@\w+)?(?:\s+(\S+))?$/i);
  if (startMatch) {
    const code = startMatch[1];
    if (!code) {
      await sendMessage(token, message.chat.id, "Buka Saku → Hubungkan bot untuk mendapatkan tautan pairing.");
      return NextResponse.json({ ok: true });
    }

    const codeHash = createHash("sha256").update(code).digest("hex");
    const { data: redemption, error: redeemError } = await admin.rpc("redeem_telegram_pairing_code", {
      p_code_hash: codeHash,
      p_chat_id: message.chat.id,
    });
    const result = Array.isArray(redemption) ? redemption[0] : redemption;

    if (redeemError) {
      await sendMessage(token, message.chat.id, "Kode pairing belum bisa diproses. Pastikan migrasi database sudah diterapkan.");
      return NextResponse.json({ ok: true });
    }
    if (!result || result.status === "invalid") {
      const { data: existingConnection } = await admin
        .from("telegram_connections")
        .select("chat_id")
        .eq("chat_id", message.chat.id)
        .maybeSingle();
      await sendMessage(token, message.chat.id, existingConnection ? "Bot ini sudah terhubung ke akun Saku-mu." : "Kode pairing tidak valid atau sudah dipakai. Buat kode baru dari web Saku.");
      return NextResponse.json({ ok: true });
    }
    if (result.status === "chat_in_use") {
      await sendMessage(token, message.chat.id, "Chat Telegram ini tidak bisa ditautkan. Periksa koneksi bot, lalu coba lagi.");
      return NextResponse.json({ ok: true });
    }

    await sendMessage(token, message.chat.id, `Akun Saku berhasil ditautkan.\n\n${helpText}`);
    return NextResponse.json({ ok: true });
  }

  const { data: connection } = await admin
    .from("telegram_connections")
    .select("user_id")
    .eq("chat_id", message.chat.id)
    .maybeSingle();

  if (!connection) {
    await sendMessage(token, message.chat.id, "Tautkan bot lewat halaman Saku terlebih dahulu. Kirim /start untuk petunjuk.");
    return NextResponse.json({ ok: true });
  }

  const receiptImage = selectReceiptImage(message);
  if (message.document && !receiptImage) {
    await sendMessage(token, message.chat.id, "Format file belum didukung. Kirim struk sebagai foto atau file gambar JPG, PNG, atau WebP (maks. 20 MB).");
    return NextResponse.json({ ok: true });
  }

  if (receiptImage) {
    const { data: claim, error: claimError } = await admin.rpc("claim_receipt_job", {
      p_update_id: update.update_id,
      p_user_id: connection.user_id,
      p_chat_id: message.chat.id,
    });
    if (claimError) return NextResponse.json({ error: "Receipt security controls are unavailable." }, { status: 503 });
    const job = claim as { status?: string; lease_id?: string } | null;
    if (!job || typeof job !== "object" || !["claimed", "duplicate", "busy", "unlinked", "rate_limited"].includes(job.status ?? "") || (job.status === "claimed" && !/^[0-9a-f-]{36}$/i.test(job.lease_id ?? ""))) {
      return NextResponse.json({ error: "Receipt security controls are unavailable." }, { status: 503 });
    }
    if (job?.status === "duplicate") return NextResponse.json({ ok: true });
    if (job?.status !== "claimed" || !job.lease_id) {
      const reply = job?.status === "rate_limited"
        ? "Batas pembacaan struk tercapai (3 per menit, 20 per hari). Coba lagi nanti atau catat manual dengan /catat."
        : job?.status === "unlinked" ? "Koneksi akun sudah berubah. Hubungkan bot kembali melalui Saku." : "Pembaca struk sedang penuh. Coba kirim ulang sebentar lagi.";
      await sendMessage(token, message.chat.id, reply);
      return NextResponse.json({ ok: true });
    }
    try {
      const { data: alreadySaved } = await admin
        .from("transactions")
        .select("id")
        .eq("telegram_update_id", update.update_id)
        .eq("user_id", connection.user_id)
        .maybeSingle();
      if (alreadySaved) {
        await sendMessage(token, message.chat.id, "Foto struk ini sudah pernah disimpan.");
        return NextResponse.json({ ok: true });
      }

      await sendMessage(token, message.chat.id, "Sedang membaca gambar struk…");
      const image = await normalizeReceiptImage(await downloadReceiptImage(token, receiptImage));
      const candidate = await recognizeReceipt(image);
      if (!candidate.amount || !validRupiah(candidate.amount)) {
        await sendMessage(token, message.chat.id, "Total belum terbaca dengan yakin. Coba foto yang lebih jelas atau catat manual dengan /catat.");
        return NextResponse.json({ ok: true });
      }

      const usedToday = candidate.date === null;
      const transactionDate = candidate.date ?? makassarDate();
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

      let { data: receipt, error: receiptError } = await admin.from("pending_receipts").insert({
        user_id: connection.user_id,
        chat_id: message.chat.id,
        telegram_update_id: update.update_id,
        merchant: candidate.merchant,
        amount: candidate.amount,
        category: "Belanja",
        transaction_date: transactionDate,
        date_was_defaulted: usedToday,
        confidence: candidate.confidence,
        expires_at: expiresAt,
      }).select("id, merchant, amount:amount_exact, transaction_date, date_was_defaulted, confidence").single();

      if (receiptError?.code === "23505") {
        const existing = await admin.from("pending_receipts")
          .select("id, merchant, amount:amount_exact, transaction_date, date_was_defaulted, confidence")
          .eq("telegram_update_id", update.update_id)
          .eq("user_id", connection.user_id)
          .eq("chat_id", message.chat.id)
          .maybeSingle();
        receipt = existing.data;
        receiptError = existing.error;
      }

      if (receiptError || !receipt) {
        await sendMessage(token, message.chat.id, "Hasil baca belum bisa disiapkan. Coba kirim ulang struk.");
        return NextResponse.json({ ok: true });
      }

      const pending = receipt as PendingReceipt;
      await sendMessage(token, message.chat.id, receiptPreview(pending), {
        inline_keyboard: [[
          { text: "Simpan transaksi", callback_data: `receipt:save:${pending.id}` },
          { text: "Batal", callback_data: `receipt:cancel:${pending.id}` },
        ]],
      });
    } catch (error) {
      const reply = error instanceof ReceiptImageError && error.code === "too_large"
        ? "Gambar terlalu besar. Kirim foto atau file gambar berukuran maksimal 20 MB."
        : error instanceof ReceiptImageError && error.code === "too_many_pixels"
          ? "Dimensi gambar terlalu besar. Kirim gambar maksimal 20 megapixel dan sisi maksimal 10.000 pixel."
        : error instanceof ReceiptImageError && error.code === "invalid_image"
          ? "Gambar rusak atau memiliki beberapa frame. Kirim satu gambar struk JPG, PNG, atau WebP."
        : error instanceof ReceiptOcrBusyError
          ? "Pembaca struk sedang penuh. Coba kirim ulang sebentar lagi."
        : error instanceof ReceiptImageError && error.code === "unsupported_format"
          ? "File ini bukan gambar JPG, PNG, atau WebP yang didukung. Kirim ulang struk dalam salah satu format tersebut."
          : "Gambar struk belum bisa diproses. Coba kirim ulang atau catat manual dengan /catat.";
      await sendMessage(token, message.chat.id, reply);
    } finally {
      // A stale lease expires automatically even if the release request fails.
      await admin.rpc("finish_receipt_job", { p_update_id: update.update_id, p_user_id: connection.user_id, p_lease_id: job.lease_id }).then(() => {}, () => {});
    }
    return NextResponse.json({ ok: true });
  }

  if (/^\/(help|start)(?:@\w+)?$/i.test(text)) {
    await sendMessage(token, message.chat.id, helpText);
    return NextResponse.json({ ok: true });
  }

  if (/^\/(ringkasan|akun|utang|piutang)(?:@\w+)?$/i.test(text)) {
    const today = makassarDate();
    const range = monthRange(today);
    const { data: books, error } = await admin.rpc("telegram_ledger_summary", { p_chat_id: message.chat.id, p_start_date: range.start, p_end_date: range.end });
    if (error || !books || !Array.isArray(books.accounts)) {
      await sendMessage(token, message.chat.id, "Ringkasan belum bisa dibaca. Pastikan migrasi database sudah diterapkan.");
      return NextResponse.json({ ok: true });
    }
    const format = (value: unknown) => formatRupiah(exactRupiah(value));
    if (!/^\/ringkasan/i.test(text)) {
      const accounts = books.accounts as Array<{ code: string; name: string; account_type: string; role: string; balance: string }>;
      const filtered = accounts.filter(a => /^\/utang/i.test(text) ? a.account_type === "liability" : /^\/piutang/i.test(text) ? a.role === "receivable" : true);
      await sendMessage(token, message.chat.id, `Akun dan saldo\n${filtered.slice(0, 20).map(a => `${a.code} ${a.name.slice(0, 50)}: ${format(a.balance)}`).join("\n")}\n\nLihat seluruh akun di web. Untuk pihak tertentu, buat akun terpisah lalu gunakan kodenya di /jurnal.`);
    } else {
      await sendMessage(token, message.chat.id, `Ringkasan bulan ini\nPendapatan: ${format(books.income)}\nBeban: ${format(books.expense)}\nLaba/rugi: ${format((exactRupiah(books.income) - exactRupiah(books.expense)).toString())}\nKas masuk: ${format(books.cash_in)}\nKas keluar: ${format(books.cash_out)}\n\nPokok utang/piutang, modal, dan transfer sendiri terpisah dari pendapatan/beban.`);
    }
    return NextResponse.json({ ok: true });
  }

  const command = parseTelegramJournal(text);
  if (command === "invalid_amount" || command === "invalid_format") {
    await sendMessage(token, message.chat.id, (command === "invalid_amount" ? "Nominal belum valid. Gunakan maksimal dua desimal. Contoh: 3681341.75, 3.681.341,75, 30rb, atau 1,5jt.\n\n" : "Lengkapi jenis, nominal, kategori, dan keterangan.\n\n") + helpText);
    return NextResponse.json({ ok: true });
  }
  if (command) {
    const { amount, category, memo: description } = command;
    if (!command.legacy) {
      const { data: result, error } = await admin.rpc("post_telegram_journal", {
        p_chat_id: message.chat.id, p_update_id: update.update_id, p_entry_date: makassarDate(), p_memo: description,
        p_entry_type: command.type, p_category: category, p_debit_code: command.debit, p_credit_code: command.credit, p_amount: amount,
      });
      const status = result?.status;
      const reply = error ? "Jurnal belum tersimpan. Pastikan migrasi pembukuan sudah diterapkan, lalu coba lagi."
        : status === "posted" ? `Jurnal tersimpan: Debit ${command.debit}, Kredit ${command.credit}, ${formatRupiah(amount)}.`
        : status === "duplicate" ? "Pesan ini sudah pernah dicatat."
        : status === "invalid_account" ? "Kode akun tidak tersedia. Gunakan /akun untuk melihat kode milikmu."
        : status === "unlinked" ? "Koneksi Telegram sudah berubah. Hubungkan kembali melalui Saku."
        : "Jurnal belum tersimpan karena benturan data. Coba kirim ulang.";
      await sendMessage(token, message.chat.id, reply);
      return NextResponse.json({ ok: true });
    }
    const kind = command.legacy;

    const { error } = await admin.from("transactions").insert({
      user_id: connection.user_id,
      kind,
      amount,
      category,
      description,
      transaction_date: makassarDate(),
      source: "telegram",
      telegram_update_id: update.update_id,
    });
    if (error?.code === "23505") {
      const { data: existing, error: lookupError } = await admin.from("transactions")
        .select("id")
        .eq("telegram_update_id", update.update_id)
        .eq("user_id", connection.user_id)
        .maybeSingle();
      await sendMessage(token, message.chat.id, existing && !lookupError
        ? "Pesan ini sudah pernah dicatat."
        : "Transaksi belum tersimpan karena benturan data. Coba kirim ulang pesan.");
      return NextResponse.json({ ok: true });
    }
    if (error) {
      await sendMessage(token, message.chat.id, "Transaksi belum tersimpan. Coba lagi sebentar.");
      return NextResponse.json({ ok: true });
    }

    const amountText = formatRupiah(amount);
    await sendMessage(token, message.chat.id, `Tersimpan: ${kind === "income" ? "pemasukan" : "pengeluaran"} ${amountText} · ${category}.`);
    return NextResponse.json({ ok: true });
  }

  await sendMessage(token, message.chat.id, `Aku belum mengenali perintah itu.\n\n${helpText}`);
  return NextResponse.json({ ok: true });
}
