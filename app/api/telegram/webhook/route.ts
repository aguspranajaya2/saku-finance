import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { recognizeReceipt } from "@/lib/receipts/ocr";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type TelegramMessage = {
  chat: { id: number; type: string };
  text?: string;
  photo?: Array<{ file_id: string; file_size?: number }>;
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

async function downloadTelegramPhoto(token: string, fileId: string) {
  const metadataResponse = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!metadataResponse.ok) throw new Error("File info unavailable.");
  const metadata = await metadataResponse.json() as { ok?: boolean; result?: { file_path?: string; file_size?: number } };
  const filePath = metadata.result?.file_path;
  if (!metadata.ok || !filePath) throw new Error("Telegram photo path missing.");
  if ((metadata.result?.file_size ?? 0) > 20 * 1024 * 1024) throw new Error("Receipt photo is too large.");

  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  const fileResponse = await fetch(`https://api.telegram.org/file/bot${token}/${encodedPath}`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!fileResponse.ok || !fileResponse.headers.get("content-type")?.startsWith("image/")) {
    throw new Error("Telegram did not return an image.");
  }
  const image = Buffer.from(await fileResponse.arrayBuffer());
  if (image.length > 20 * 1024 * 1024) throw new Error("Receipt photo is too large.");
  return image;
}

function receiptPreview(receipt: PendingReceipt) {
  const amount = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(receipt.amount));
  const date = new Date(`${receipt.transaction_date}T12:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Makassar" });
  const confidence = Math.round(Number(receipt.confidence));
  const dateNote = receipt.date_was_defaulted ? " (tanggal default hari ini)" : "";
  const confidenceNote = confidence < 55 ? "\nHasil OCR kurang jelas, periksa nominal dengan teliti." : "";
  return `Periksa hasil baca struk:\nToko: ${receipt.merchant}\nTotal: ${amount}\nTanggal: ${date}${dateNote}\nAkurasi teks: ${confidence}%${confidenceNote}\n\nJika nominal perlu dikoreksi, tekan Batal lalu catat manual.`;
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
  "/ringkasan — ringkasan bulan ini",
  "/help — bantuan",
  "Kirim foto struk untuk alur pencatatan struk.",
].join("\n");

export async function POST(request: Request) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!token || !webhookSecret) {
    return NextResponse.json({ error: "Telegram belum dikonfigurasi." }, { status: 503 });
  }
  if (request.headers.get("x-telegram-bot-api-secret-token") !== webhookSecret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ error: "Invalid update." }, { status: 400 });
  }

  const message = update.message;
  const callback = update.callback_query;
  const chat = message?.chat ?? callback?.message?.chat;
  if (!chat || chat.type !== "private") return NextResponse.json({ ok: true });

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: "Supabase server credentials are missing." }, { status: 503 });
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
        await answerCallback(token, callback.id, "Struk kedaluwarsa atau sudah diproses.");
        return NextResponse.json({ ok: true });
      }
      await answerCallback(token, callback.id, "Transaksi tersimpan.");
      await sendMessage(token, callback.message.chat.id, "Transaksi struk berhasil disimpan ke Saku.");
      return NextResponse.json({ ok: true });
    }

    const { data: cancelled, error } = await admin
      .from("pending_receipts")
      .delete()
      .eq("id", receiptId)
      .eq("chat_id", callback.message.chat.id)
      .select("id")
      .maybeSingle();
    await answerCallback(token, callback.id, cancelled && !error ? "Dibatalkan." : "Struk kedaluwarsa atau sudah diproses.");
    if (cancelled && !error) {
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

  if (message.photo?.length) {
    try {
      const { data: alreadySaved } = await admin
        .from("transactions")
        .select("id")
        .eq("telegram_update_id", update.update_id)
        .maybeSingle();
      if (alreadySaved) {
        await sendMessage(token, message.chat.id, "Foto struk ini sudah pernah disimpan.");
        return NextResponse.json({ ok: true });
      }

      const photo = message.photo[message.photo.length - 1];
      await sendMessage(token, message.chat.id, "Sedang membaca foto struk dengan OCR lokal…");
      const image = await downloadTelegramPhoto(token, photo.file_id);
      const candidate = await recognizeReceipt(image);
      if (!candidate.amount || !Number.isSafeInteger(candidate.amount)) {
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
      }).select("id, merchant, amount, transaction_date, date_was_defaulted, confidence").single();

      if (receiptError?.code === "23505") {
        const existing = await admin.from("pending_receipts")
          .select("id, merchant, amount, transaction_date, date_was_defaulted, confidence")
          .eq("telegram_update_id", update.update_id)
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
    } catch {
      await sendMessage(token, message.chat.id, "Foto belum bisa dibaca. Coba foto yang lebih terang atau catat manual dengan /catat.");
    }
    return NextResponse.json({ ok: true });
  }

  if (/^\/(help|start)(?:@\w+)?$/i.test(text)) {
    await sendMessage(token, message.chat.id, helpText);
    return NextResponse.json({ ok: true });
  }

  if (/^\/ringkasan(?:@\w+)?$/i.test(text)) {
    const today = makassarDate();
    const range = monthRange(today);
    const { data: rows, error } = await admin
      .from("transactions")
      .select("kind, amount")
      .eq("user_id", connection.user_id)
      .gte("transaction_date", range.start)
      .lt("transaction_date", range.end);
    if (error) {
      await sendMessage(token, message.chat.id, "Ringkasan belum bisa dibaca. Pastikan migrasi database sudah diterapkan.");
      return NextResponse.json({ ok: true });
    }
    const totals = (rows ?? []).reduce((summary, row) => {
      summary[row.kind as "income" | "expense"] += Number(row.amount);
      return summary;
    }, { income: 0, expense: 0 });
    const format = (value: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
    await sendMessage(token, message.chat.id, `Ringkasan bulan ini\nPemasukan: ${format(totals.income)}\nPengeluaran: ${format(totals.expense)}\nArus bersih: ${format(totals.income - totals.expense)}`);
    return NextResponse.json({ ok: true });
  }

  const command = text.match(/^\/catat(?:@\w+)?\s+(\S+)\s+(\S+)\s+(\S+)(?:\s+(.+))?$/i);
  if (command) {
    const typeText = command[1].toLowerCase();
    const kind = ["masuk", "pemasukan", "income"].includes(typeText)
      ? "income"
      : ["keluar", "pengeluaran", "expense"].includes(typeText)
        ? "expense"
        : null;
    const amount = Number(command[2].replace(/[^\d]/g, ""));
    const category = command[3].replace(/_/g, " ").slice(0, 60);
    const description = (command[4]?.trim() || category).slice(0, 240);

    if (!kind || !Number.isSafeInteger(amount) || amount <= 0) {
      await sendMessage(token, message.chat.id, "Format belum dikenali.\n\n" + helpText);
      return NextResponse.json({ ok: true });
    }

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
      await sendMessage(token, message.chat.id, "Pesan ini sudah pernah dicatat.");
      return NextResponse.json({ ok: true });
    }
    if (error) {
      await sendMessage(token, message.chat.id, "Transaksi belum tersimpan. Coba lagi sebentar.");
      return NextResponse.json({ ok: true });
    }

    const amountText = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(amount);
    await sendMessage(token, message.chat.id, `Tersimpan: ${kind === "income" ? "pemasukan" : "pengeluaran"} ${amountText} · ${category}.`);
    return NextResponse.json({ ok: true });
  }

  await sendMessage(token, message.chat.id, `Aku belum mengenali perintah itu.\n\n${helpText}`);
  return NextResponse.json({ ok: true });
}
