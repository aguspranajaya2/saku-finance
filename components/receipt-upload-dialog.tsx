"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { LedgerModal, useLedgerText } from "@/components/ledger-ui";
import type { ReceiptCandidate } from "@/lib/receipts/parse";

export function ReceiptUploadDialog({ onClose, onRead }: { onClose: () => void; onRead: (candidate: ReceiptCandidate) => void }) {
  const { t } = useLedgerText();
  const [file, setFile] = useState<File | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file || busy) return;
    setError("");
    if (file.size > 4 * 1024 * 1024) { setError(t("Use an image smaller than 4 MB. Telegram accepts up to 20 MB.", "Gunakan gambar di bawah 4 MB. Telegram menerima hingga 20 MB.")); return; }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setError(t("Choose a JPG, PNG or WebP image.", "Pilih gambar JPG, PNG, atau WebP.")); return; }
    setBusy(true);
    const abort = new AbortController(); controller.current = abort;
    try {
      const response = await fetch("/api/receipts/recognize", { method: "POST", headers: { "Content-Type": file.type }, body: file, signal: abort.signal });
      const result = await response.json();
      if (!response.ok) {
        setError(response.status === 401 ? t("Sign in before reading a receipt.", "Masuk terlebih dahulu untuk membaca bukti.")
          : response.status === 429 ? t("The reader is busy or your limit was reached. Try again later.", "Pembaca sedang penuh atau batas tercapai. Coba lagi nanti.")
          : t("Could not read this image. Check its size and format, or enter the transaction manually.", "Gambar belum bisa dibaca. Periksa ukuran dan formatnya, atau catat manual."));
        return;
      }
      if (!abort.signal.aborted && result.candidate) onRead(result.candidate);
    } catch { if (!abort.signal.aborted) setError(t("Could not read the receipt. Check your connection and try again.", "Bukti belum bisa dibaca. Periksa koneksi dan coba lagi.")); }
    finally { if (!abort.signal.aborted) setBusy(false); }
  }
  return <LedgerModal title={t("Read a receipt or transfer", "Baca struk atau bukti transfer")} onClose={onClose} busy={busy}><form className="transaction-form" onSubmit={submit}>
    <p className="ledger-help">{t("Upload the original proof. Review the amount, date, purpose and accounts before posting. The image is processed without saving it to your records.", "Unggah bukti asli. Periksa nominal, tanggal, tujuan, dan akun sebelum menyimpan. Gambar diproses tanpa disimpan dalam catatanmu.")}</p>
    <label>{t("Receipt image · up to 4 MB", "Gambar bukti · maksimal 4 MB")}<input type="file" accept="image/jpeg,image/png,image/webp" required disabled={busy} onChange={event => { setFile(event.target.files?.[0] ?? null); setError(""); }} /></label>
    {error && <p role="alert" className="auth-feedback error-feedback">{error}</p>}
    <div className="modal-actions"><button className="cancel-button" type="button" disabled={busy} onClick={onClose}>{t("Cancel", "Batal")}</button><button className="primary-button" type="submit" disabled={busy || !file}>{busy ? t("Reading image…", "Membaca gambar…") : t("Read image", "Baca gambar")}</button></div>
  </form></LedgerModal>;
}
