"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { usePreferences } from "@/lib/preferences";
import { useLedger } from "@/components/ledger-provider";
import { entryTypeLabel, journalTotal, type JournalEntry } from "@/lib/ledger";
import { formatRupiah, type Rupiah } from "@/lib/money";

export function useLedgerText() {
  const { language, amountsHidden } = usePreferences();
  const money = useMemo(() => ({ format: (value: Rupiah | bigint) => formatRupiah(value, language, amountsHidden) }), [language, amountsHidden]);
  return { language, amountsHidden, money, t: (en: string, id: string) => language === "en" ? en : id };
}
export function LedgerStatus() {
  const { configured, error, refresh, loading } = useLedger();
  const { t } = useLedgerText();
  const messages = {
    migration: t("Accounting setup is not ready. Ask the site owner to finish the database setup.", "Pembukuan belum siap. Minta pengelola menyelesaikan pengaturan database."),
    connection: t("Could not refresh your books. Check your connection, then refresh before retrying a saved entry.", "Buku belum dapat disegarkan. Periksa koneksi, lalu muat ulang sebelum mengulangi pencatatan."),
    save: t("Could not save. Check your connection and account access, then try again.", "Belum dapat menyimpan. Periksa koneksi dan akses akun, lalu coba lagi."),
    invalid: t("Check the date, accounts, amounts (up to two decimals), and balanced debit/credit totals.", "Periksa tanggal, akun, nominal (maksimal dua desimal), dan keseimbangan debit/kredit."),
    duplicate: t("This account code is already in use. Choose a different code.", "Kode akun sudah dipakai. Gunakan kode lain."),
  };
  return <>{!configured && <div className="demo-note"><span className="demo-dot" />{t("Preview books · changes reset on reload", "Buku pratinjau · perubahan direset saat dimuat ulang")}</div>}
    {error && <div className="inline-notice ledger-notice" role="alert"><span>{messages[error]}</span><button className="subtle-link" disabled={loading} onClick={refresh} type="button">{t("Refresh", "Muat ulang")}</button></div>}</>;
}
export function LedgerModal({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const { t } = useLedgerText();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null, overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.querySelector<HTMLElement>("input,select,button")?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={e => { if (!busy && e.target === e.currentTarget) onClose(); }}>
    <section aria-label={title} aria-modal="true" role="dialog" className="transaction-modal ledger-modal" ref={ref} onKeyDown={e => {
      if (e.key === "Escape" && !busy) onClose();
      if (e.key !== "Tab") return;
      const items = [...e.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]")];
      if (e.shiftKey && document.activeElement === items[0]) { e.preventDefault(); items.at(-1)?.focus(); }
      else if (!e.shiftKey && document.activeElement === items.at(-1)) { e.preventDefault(); items[0]?.focus(); }
    }}><div className="modal-top"><h2>{title}</h2><button className="modal-close" aria-label={t("Close", "Tutup")} disabled={busy} onClick={onClose} type="button">×</button></div>{children}</section>
  </div>;
}
export function JournalList({ entries, onReverse }: { entries: JournalEntry[]; onReverse?: (entry: JournalEntry) => void }) {
  const { accounts } = useLedger();
  const { t, money, language } = useLedgerText();
  const names = new Map(accounts.map(a => [a.id, `${a.code} · ${a.name}`]));
  return <div className="journal-list">{entries.map(entry => <details className="journal-record" key={entry.id}>
    <summary><span className="journal-date">{entry.entry_date}</span><span className="journal-record-title"><strong>{entry.memo}</strong><span>{entryTypeLabel(entry.entry_type, language)} · {entry.category}{entry.reversed_by ? ` · ${t("Reversed", "Sudah dibalik")}` : ""}</span></span><strong className="journal-record-total">{money.format(journalTotal(entry))}<span>{t("Debit = Credit", "Debit = Kredit")}</span></strong></summary>
    <div className="ledger-table-wrap"><table className="ledger-table"><thead><tr><th>{t("Account", "Akun")}</th><th className="number">Debit</th><th className="number">{t("Credit", "Kredit")}</th></tr></thead>
      <tbody>{entry.journal_lines.map((line, index) => <tr key={index}><td>{names.get(line.account_id) ?? t("Account unavailable", "Akun tidak tersedia")}</td><td className="number">{line.debit ? money.format(line.debit) : "—"}</td><td className="number">{line.credit ? money.format(line.credit) : "—"}</td></tr>)}</tbody></table></div>
    <div className="journal-record-footer"><span>{t("Source", "Sumber")}: {entry.source} · #{entry.id.slice(0, 8)}</span>{onReverse && !entry.reversal_of && !entry.reversed_by && <button className="subtle-link" onClick={() => onReverse(entry)} type="button">{t("Post reversal", "Buat jurnal pembalik")}</button>}</div>
  </details>)}{!entries.length && <div className="empty-state">{t("No journal entries for this selection.", "Belum ada jurnal untuk pilihan ini.")}</div>}</div>;
}
