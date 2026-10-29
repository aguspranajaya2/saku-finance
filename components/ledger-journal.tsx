"use client";
import { useState } from "react";
import { useLedger } from "@/components/ledger-provider";
import { JournalDialog } from "@/components/journal-dialog";
import { ReverseDialog } from "@/components/account-dialog";
import { JournalList, LedgerStatus, useLedgerText } from "@/components/ledger-ui";
import { entryTypeLabel, journalTotal, type EntryType, type JournalEntry, type QuickKind } from "@/lib/ledger";
import { ReceiptUploadDialog } from "@/components/receipt-upload-dialog";
import type { ReceiptCandidate } from "@/lib/receipts/parse";

export default function TransactionsPage() {
  const { accounts, entries, loading, clearError } = useLedger(); const { t, money, language } = useLedgerText();
  const [open, setOpen] = useState(false), [mode, setMode] = useState<QuickKind | "journal">("expense"), [reversal, setReversal] = useState<JournalEntry | null>(null);
  const [upload, setUpload] = useState(false), [receipt, setReceipt] = useState<ReceiptCandidate | undefined>();
  const [query, setQuery] = useState(""), [type, setType] = useState("all"), [account, setAccount] = useState("all"), [from, setFrom] = useState(""), [until, setUntil] = useState("");
  const names = new Map(accounts.map(a => [a.id, `${a.code} ${a.name}`]));
  const selected = entries.filter(e => {
    if (type !== "all" && e.entry_type !== type || from && e.entry_date < from || until && e.entry_date > until) return false;
    if (account !== "all" && !e.journal_lines.some(l => l.account_id === account)) return false;
    return `${e.memo} ${e.category} ${e.journal_lines.map(l => names.get(l.account_id)).join(" ")}`.toLowerCase().includes(query.trim().toLowerCase());
  }).sort((a, b) => b.entry_date.localeCompare(a.entry_date) || b.created_at.localeCompare(a.created_at));
  function launch(kind: QuickKind | "journal") { clearError(); setReceipt(undefined); setMode(kind); setOpen(true); }
  return <div className="page-content ledger-page journal-page"><div className="page-heading"><div><h1>{t("General journal", "Jurnal umum")}</h1><p className="page-subtitle">{t("All transactions, with balanced postings and a permanent correction history.", "Seluruh transaksi, dengan jurnal seimbang dan riwayat koreksi yang tersimpan.")}</p></div><div className="ledger-heading-actions"><button className="secondary-button" disabled={loading || !accounts.length} onClick={() => setUpload(true)} type="button">{t("Read proof", "Baca bukti")}</button><button className="secondary-button" disabled={loading || !accounts.length} onClick={() => launch("journal")} type="button">{t("Manual journal", "Jurnal manual")}</button><button className="primary-button" disabled={loading || !accounts.length} onClick={() => launch("expense")} type="button">＋ {t("Record activity", "Catat aktivitas")}</button></div></div>
    <LedgerStatus />{loading ? <div className="page-skeleton" /> : <section className="panel ledger-panel">
      <details className="journal-filters"><summary>{t("Filters", "Filter")}</summary><div className="ledger-toolbar"><label>{t("Search", "Cari")}<input value={query} onChange={e => setQuery(e.target.value)} placeholder={t("Memo, category or account", "Keterangan, kategori, atau akun")} /></label><label>{t("Type", "Jenis")}<select value={type} onChange={e => setType(e.target.value)}><option value="all">{t("All types", "Semua jenis")}</option>{(["income", "expense", "borrow", "lend", "repay_debt", "collect_receivable", "transfer", "journal", "closing", "opening", "reversal"] as EntryType[]).map(k => <option value={k} key={k}>{entryTypeLabel(k, language)}</option>)}</select></label><label>{t("Account", "Akun")}<select value={account} onChange={e => setAccount(e.target.value)}><option value="all">{t("All accounts", "Semua akun")}</option>{accounts.map(a => <option value={a.id} key={a.id}>{a.code} · {a.name}</option>)}</select></label><label>{t("From", "Dari")}<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label>{t("Through", "Sampai")}<input type="date" value={until} min={from || undefined} onChange={e => setUntil(e.target.value)} /></label></div></details>
      <div className="ledger-selection-summary"><span>{selected.length} {t("entries", "jurnal")}</span><span>{t("Total debit = credit", "Total debit = kredit")}: <strong>{money.format(selected.reduce((sum, e) => sum + journalTotal(e), 0n))}</strong></span></div>
      <JournalList entries={selected} onReverse={e => { clearError(); setReversal(e); }} />
    </section>}
    {upload && <ReceiptUploadDialog onClose={() => setUpload(false)} onRead={candidate => { clearError(); setReceipt(candidate); setMode("expense"); setUpload(false); setOpen(true); }} />}<JournalDialog open={open} onClose={() => { setOpen(false); setReceipt(undefined); }} initialKind={mode} receipt={receipt} />{reversal && <ReverseDialog entry={reversal} onClose={() => setReversal(null)} />}
  </div>;
}
