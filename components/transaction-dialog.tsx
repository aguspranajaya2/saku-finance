"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { usePreferences } from "@/lib/preferences";
import type { NewTransaction } from "@/lib/finance";

export function TransactionDialog({
  open,
  onClose,
  onSave,
  saving,
  configured,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (transaction: NewTransaction) => Promise<boolean>;
  saving: boolean;
  configured: boolean;
  error: string;
}) {
  const { language } = usePreferences();
  const [kind, setKind] = useState<"income" | "expense">("expense");
  const dialogRef = useRef<HTMLElement>(null);
  const text = (en: string, id: string) => language === "en" ? en : id;
  const localeDate = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.querySelector<HTMLInputElement>('input[name="amount"]')?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [open]);

  if (!open) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const amount = Number(form.get("amount"));
    const date = String(form.get("date") ?? "");
    if (saving || !title || !Number.isSafeInteger(amount) || amount <= 0 || !date) return;
    const saved = await onSave({
      title,
      amount,
      category: String(form.get("category") ?? "Lainnya"),
      date,
      kind,
    });
    if (saved) onClose();
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => !saving && event.target === event.currentTarget && onClose()}>
      <section aria-labelledby="modal-title" aria-modal="true" className="transaction-modal" ref={dialogRef} role="dialog" onKeyDown={(event) => {
        if (event.key === "Escape" && !saving) { event.preventDefault(); onClose(); }
        if (event.key !== "Tab") return;
        const fields = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled]), input, select")];
        const first = fields[0];
        const last = fields[fields.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
        <div className="modal-top">
          <div><span className="eyebrow">{text("NEW ENTRY", "CATAT KEUANGAN")}</span><h2 id="modal-title">{text("New transaction", "Transaksi baru")}</h2></div>
          <button aria-label={text("Close", "Tutup")} className="modal-close" disabled={saving} onClick={onClose} type="button">×</button>
        </div>
        <div aria-label={text("Transaction type", "Jenis transaksi")} className="kind-toggle" role="group">
          <button className={kind === "expense" ? "active expense-choice" : ""} onClick={() => setKind("expense")} type="button">↗ {text("Expense", "Pengeluaran")}</button>
          <button className={kind === "income" ? "active income-choice" : ""} onClick={() => setKind("income")} type="button">↙ {text("Income", "Pemasukan")}</button>
        </div>
        <form className="transaction-form" onSubmit={submit}>
          <label>{text("Amount", "Nominal")}<span className="field-currency">IDR</span><input autoFocus max={Number.MAX_SAFE_INTEGER} min="1" name="amount" placeholder="0" required step="1" type="number" /></label>
          <label>{text("Transaction name", "Nama transaksi")}<input maxLength={200} name="title" placeholder={text("e.g. lunch", "Contoh: makan siang")} required type="text" /></label>
          <div className="form-row">
            <label>{text("Category", "Kategori")}<select name="category"><option value="Makanan">{text("Food", "Makanan")}</option><option value="Belanja">{text("Shopping", "Belanja")}</option><option value="Transportasi">{text("Transport", "Transportasi")}</option><option value="Tagihan">{text("Bills", "Tagihan")}</option><option value="Gaji">{text("Salary", "Gaji")}</option><option value="Freelance">Freelance</option><option value="Lainnya">{text("Other", "Lainnya")}</option></select></label>
            <label>{text("Date", "Tanggal")}<input defaultValue={localeDate} name="date" required type="date" /></label>
          </div>
          <div className="modal-note">{configured ? text("Saved securely to your account.", "Tersimpan aman di akunmu.") : text("Preview entries reset when the page is refreshed.", "Catatan pratinjau akan direset saat halaman dimuat ulang.")}</div>
          {error && <p className="auth-feedback error-feedback" role="alert">{error}</p>}
          <div className="modal-actions"><button className="cancel-button" disabled={saving} onClick={onClose} type="button">{text("Cancel", "Batal")}</button><button className="primary-button save-button" disabled={saving} type="submit">{saving ? text("Saving…", "Menyimpan…") : text("Save transaction", "Simpan transaksi")}</button></div>
        </form>
      </section>
    </div>
  );
}
