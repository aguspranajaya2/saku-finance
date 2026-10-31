"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLedger } from "@/components/ledger-provider";
import { LedgerModal, useLedgerText } from "@/components/ledger-ui";
import { PasswordInput } from "@/components/password-input";
import styles from "@/components/reset-bookkeeping.module.css";

export function ResetBookkeeping({ userId, onReset }: { userId: string | null; onReset: () => void }) {
  const { t } = useLedgerText();
  const { saving, loading, refresh } = useLedger();
  const [requestId, setRequestId] = useState<string | null>(null), [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState(""), [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [success, setSuccess] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  function close() { if (busy) return; setRequestId(null); setPassword(""); setConfirmation(""); setAcknowledged(false); setError(""); }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!userId || !requestId || busy || saving || loading || !password || confirmation !== "RESET" || !acknowledged) return;
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/books/reset", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedUserId: userId, requestId, password, confirmation }), signal: abort.signal });
      const result = await response.json();
      if (abort.signal.aborted) return;
      if (!response.ok || result.ok !== true) {
        setError(result.error === "invalid_password" ? t("Incorrect password. Your books have not been reset.", "Kata sandi salah. Pembukuanmu belum direset.")
          : result.error === "setup_required" ? t("Reset is not available yet. Ask the site owner to apply the bookkeeping reset migration.", "Reset belum tersedia. Minta pengelola menjalankan migrasi reset pembukuan.")
          : result.error === "stale_session" || result.error === "unauthorized" ? t("Your account session changed. Reload and sign in before trying again.", "Sesi akun berubah. Muat ulang dan masuk sebelum mencoba kembali.")
          : result.error === "rate_limited" ? t("Too many attempts. Wait before trying again.", "Terlalu banyak percobaan. Tunggu sebelum mencoba lagi.")
          : t("The reset could not be confirmed. Reload your books to check; retrying in this dialog uses the same request.", "Reset belum dapat dipastikan. Muat ulang pembukuan untuk memeriksa; mencoba lagi di dialog ini memakai permintaan yang sama."));
        return;
      }
      setSuccess(true); setRequestId(null); setConfirmation(""); setAcknowledged(false);
      onReset(); refresh();
      // Notify only other tabs for this owner. No financial data is stored here.
      try { window.localStorage.setItem("saku-books-reset", JSON.stringify({ userId, requestId })); } catch { /* Focus refresh still works when storage is blocked. */ }
    } catch { if (!abort.signal.aborted) setError(t("Connection lost. Check your books before retrying; this dialog keeps the same reset request.", "Koneksi terputus. Periksa pembukuan sebelum mencoba lagi; dialog ini mempertahankan permintaan reset yang sama.")); }
    finally { if (!abort.signal.aborted) { setBusy(false); setPassword(""); } }
  }
  return <section className={`settings-section ${styles.section}`} id="reset-bookkeeping" aria-labelledby="reset-books-title">
    <div className="settings-section-heading"><div><h2 id="reset-books-title">{t("Reset bookkeeping", "Reset pembukuan")}</h2><p>{t("Start again with zero balances", "Mulai kembali dengan saldo nol")}</p></div></div>
    <article className={`panel settings-card ${styles.card}`}>
      <div><h3>{t("Clear your financial records", "Kosongkan catatan keuanganmu")}</h3><p>{t("Permanently delete your journals, transactions, opening balances and pending receipts. Your login, username and account list are kept. Telegram will be disconnected.", "Hapus permanen jurnal, transaksi, saldo awal, dan struk tertunda milikmu. Login, username, serta daftar akun/rekening tetap tersimpan. Telegram akan diputus.")}</p></div>
      <button className={styles.resetButton} type="button" disabled={!userId || saving || loading || busy} onClick={() => { setRequestId(crypto.randomUUID()); setSuccess(false); setError(""); }}>{t("Reset bookkeeping…", "Reset pembukuan…")}</button>
      {!userId && <p className={styles.notice}>{t("Sign in to reset your own bookkeeping.", "Masuk untuk mereset pembukuanmu sendiri.")}</p>}
      {success && <p className={styles.notice} role="status">{t("Bookkeeping reset. Your balances start at zero. Reconnect Telegram when you are ready.", "Pembukuan sudah direset. Saldo dimulai dari nol. Hubungkan kembali Telegram saat sudah siap.")}</p>}
    </article>
    {requestId && <LedgerModal title={t("Confirm bookkeeping reset", "Konfirmasi reset pembukuan")} onClose={close} busy={busy}><form className={styles.form} onSubmit={submit}>
      <p className={styles.warning}>{t("This permanently deletes your complete financial history, including corrections and opening balances. It cannot be undone.", "Ini menghapus permanen seluruh riwayat keuanganmu, termasuk koreksi dan saldo awal. Penghapusan tidak dapat dibatalkan.")}</p>
      <p>{t("Your account list and login are kept. Pending receipt buttons are revoked and Telegram is disconnected. This affects your account only.", "Daftar akun/rekening dan login tetap tersimpan. Tombol struk tertunda dicabut dan Telegram diputus. Reset hanya berlaku untuk akunmu.")}</p>
      <label htmlFor="reset-books-password">{t("Current password", "Kata sandi saat ini")}<PasswordInput id="reset-books-password" autoComplete="current-password" required maxLength={1024} disabled={busy} value={password} onChange={event => setPassword(event.target.value)} /></label>
      <label htmlFor="reset-books-confirmation">{t("Type RESET to confirm", "Ketik RESET untuk konfirmasi")}<input id="reset-books-confirmation" autoComplete="off" spellCheck={false} value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} required pattern="RESET" maxLength={5} /></label>
      <label className={styles.checkbox}><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} disabled={busy} required /><span>{t("I understand that my financial records will be permanently deleted.", "Saya memahami bahwa catatan keuangan saya akan dihapus permanen.")}</span></label>
      {error && <p className={styles.warning} role="alert">{error}</p>}
      <div className={styles.actions}><button className={styles.cancelButton} type="button" disabled={busy} onClick={close}>{t("Cancel", "Batal")}</button><button className={styles.resetButton} type="submit" disabled={busy || saving || loading || !password || confirmation !== "RESET" || !acknowledged}>{busy ? t("Resetting…", "Mereset…") : t("Permanently reset my books", "Reset pembukuan secara permanen")}</button></div>
    </form></LedgerModal>}
  </section>;
}
