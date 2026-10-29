import { formatRupiah } from "@/lib/money";
import type { ReceiptCandidate } from "@/lib/receipts/parse";

export function transferPreview(candidate: ReceiptCandidate) {
  if (candidate.amount === null) return "Nominal transfer belum terbaca dengan yakin. Catat manual di Saku.";
  const date = candidate.date ? ` @${candidate.date}` : "";
  return [
    "Periksa bukti transfer (belum disimpan):",
    candidate.merchant,
    `Nominal: ${formatRupiah(candidate.amount)}`,
    `Tanggal: ${candidate.date ?? "Belum terbaca — atur tanggal di web"}`,
    "",
    "Transfer bisa berupa belanja, pembayaran utang, piutang, atau pemindahan uang sendiri. Pilih sesuai tujuannya.",
    "Buka Saku → Jurnal umum → Baca bukti untuk memilih jenis, rekening, dan tanggal sebelum menyimpan.",
    "",
    "Atau jika ini pembayaran belanja dari akun Bank 1010 ke Beban 5000, salin dan kirim:",
    `/jurnal 5000 1010 ${candidate.amount}${date} ${candidate.merchant}`,
    "Periksa /akun dulu; ganti kode sesuai rekeningmu. Perintah tanpa @tanggal memakai tanggal hari ini. Untuk bayar pokok utang gunakan debit akun utang; piutang gunakan debit akun piutang. Jangan catat lagi jika bukti ini sudah pernah disimpan.",
  ].join("\n");
}
