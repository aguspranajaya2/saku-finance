"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLedger } from "@/components/ledger-provider";
import { LedgerModal, LedgerStatus, useLedgerText } from "@/components/ledger-ui";
import { entryTypeLabel, quickAccounts, quickKinds, todayDate, validateJournal, type EntryType, type JournalLine, type QuickKind } from "@/lib/ledger";
import { parseRupiahAmount, exactRupiah } from "@/lib/money";
import type { ReceiptCandidate } from "@/lib/receipts/parse";

type InputLine = { key: string; account: string; debit: string; credit: string };
export function JournalDialog({ open, onClose, initialKind = "expense", initialAccount, receipt }: { open: boolean; onClose: () => void; initialKind?: QuickKind | "journal"; initialAccount?: string; receipt?: ReceiptCandidate }) {
  const { accounts, postJournal, saving, clearError } = useLedger();
  const { t, language, money } = useLedgerText();
  const [mode, setMode] = useState<"quick" | "journal">("quick"), [kind, setKind] = useState<QuickKind>("expense");
  const [manualType, setManualType] = useState<"journal" | "closing">("journal");
  const [debit, setDebit] = useState(""), [credit, setCredit] = useState(""), [amount, setAmount] = useState("");
  const [memo, setMemo] = useState(""), [date, setDate] = useState(todayDate), [category, setCategory] = useState("Lainnya");
  const [lines, setLines] = useState<InputLine[]>([]), [validation, setValidation] = useState("");
  const [activityChosen, setActivityChosen] = useState(true);
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  function chooseKind(next: QuickKind) {
    const drs = quickAccounts(next, accounts, "debit"), crs = quickAccounts(next, accounts, "credit");
    const dr = drs.find(a => a.id === initialAccount)?.id ?? drs[0]?.id ?? "";
    const cr = crs.find(a => a.id === initialAccount && a.id !== dr)?.id ?? crs.find(a => a.id !== dr)?.id ?? "";
    setKind(next); setDebit(dr); setCredit(cr); setValidation(""); setActivityChosen(true);
  }
  useEffect(() => {
    if (!open) return;
    setMode(initialKind === "journal" ? "journal" : "quick"); chooseKind(initialKind === "journal" ? "expense" : initialKind);
    setMemo(""); setAmount(""); setDate(todayDate()); setCategory("Lainnya"); setManualType("journal"); setValidation(""); request.current = null; clearError();
    setLines([{ key: crypto.randomUUID(), account: initialAccount ?? accounts[0]?.id ?? "", debit: "", credit: "" }, { key: crypto.randomUUID(), account: accounts.find(a => a.account_type === "revenue" && a.id !== initialAccount)?.id ?? accounts.find(a => a.id !== initialAccount)?.id ?? "", debit: "", credit: "" }]);
    setActivityChosen(!receipt);
    if (receipt) {
      setMemo(receipt.merchant); setAmount(receipt.amount === null ? "" : String(receipt.amount)); setDate(receipt.date ?? todayDate());
      setCategory(receipt.kind === "bank_transfer" ? "Transfer" : "Belanja");
      setDebit(""); setCredit(""); // Purpose and account ownership require user choice.
    }
    // Form resets only on a new dialog, not when a background refresh replaces arrays.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialKind, initialAccount, receipt]);
  if (!open) return null;
  const parsedAmount = parseRupiahAmount(amount);
  const journalLines: JournalLine[] = mode === "quick" ? [
    { account_id: debit, debit: parsedAmount ?? 0, credit: 0 }, { account_id: credit, debit: 0, credit: parsedAmount ?? 0 },
  ] : lines.map(line => ({ account_id: line.account, debit: !line.debit.trim() || /^0+(?:[.,]0{1,2})?$/.test(line.debit.trim()) ? 0 : parseRupiahAmount(line.debit) ?? -1,
    credit: !line.credit.trim() || /^0+(?:[.,]0{1,2})?$/.test(line.credit.trim()) ? 0 : parseRupiahAmount(line.credit) ?? -1 }));
  const debitTotal = journalLines.reduce((s, l) => s + (exactRupiah(l.debit) > 0n ? exactRupiah(l.debit) : 0n), 0n), creditTotal = journalLines.reduce((s, l) => s + (exactRupiah(l.credit) > 0n ? exactRupiah(l.credit) : 0n), 0n);
  const balanced = (mode === "journal" || activityChosen) && validateJournal(journalLines) && (mode !== "journal" || manualType !== "closing" || journalLines.every(l => accounts.some(a => a.id === l.account_id && ["equity", "revenue", "expense"].includes(a.account_type))));
  async function submit(event: FormEvent) {
    event.preventDefault(); if (saving) return;
    if (!balanced || !memo.trim() || !date) { setValidation(t("Use at least two different accounts, one positive side per line, and equal debit/credit totals.", "Gunakan minimal dua akun berbeda, satu sisi positif per baris, dan total debit/kredit yang sama.")); return; }
    const type: EntryType = mode === "journal" ? manualType : kind === "capital" || kind === "withdrawal" ? "journal" : kind;
    const entry = { date, memo: memo.trim(), type, category: category.trim() || "Lainnya", lines: journalLines };
    const fingerprint = JSON.stringify(entry);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
    if (await postJournal({ ...entry, requestId: request.current!.id })) onClose();
  }
  function updateLine(key: string, field: "account" | "debit" | "credit", value: string) { setLines(previous => previous.map(line => line.key === key ? { ...line, [field]: value } : line)); }
  return <LedgerModal title={t("Record a journal entry", "Catat jurnal")} onClose={onClose} busy={saving}><form className="transaction-form ledger-entry-form" onSubmit={submit}>
    {receipt && <div className="receipt-review-note" role="status"><strong>{t("Review the reading before posting", "Periksa hasil baca sebelum menyimpan")}</strong><p>{receipt.kind === "bank_transfer" ? t("Choose whether this transfer is a purchase, debt payment, loan or transfer between your own accounts. Select the actual bank account; no accounts have been chosen for you.", "Pilih apakah transfer ini belanja, bayar utang, pinjaman, atau antar rekening sendiri. Pilih rekening bank sebenarnya; akun belum dipilih otomatis.") : t("Check the amount, purpose and payment accounts. OCR can make mistakes.", "Periksa nominal, tujuan, dan akun pembayaran. OCR bisa keliru.")}</p>{(!receipt.date || receipt.issue) && <p>{t("Some details could not be verified. Fill them in manually; a missing date defaults to today.", "Sebagian detail belum dapat dipastikan. Lengkapi manual; tanggal yang tidak terbaca memakai hari ini.")}</p>}</div>}
    <div className="kind-toggle" role="group" aria-label={t("Entry mode", "Mode pencatatan")}><button aria-pressed={mode === "quick"} className={mode === "quick" ? "active" : ""} onClick={() => setMode("quick")} type="button">{t("Guided entry", "Pencatatan praktis")}</button><button aria-pressed={mode === "journal"} className={mode === "journal" ? "active" : ""} onClick={() => setMode("journal")} type="button">{t("General journal", "Jurnal umum")}</button></div>
    {mode === "quick" && <><label>{t("Activity", "Aktivitas")}<select required value={activityChosen ? kind : ""} onChange={e => { chooseKind(e.target.value as QuickKind); if (receipt) { setDebit(""); setCredit(""); } }}><option value="" disabled>{t("Choose the transaction purpose", "Pilih tujuan transaksi")}</option>{quickKinds.map(k => <option value={k} key={k}>{entryTypeLabel(k, language)}</option>)}</select></label>
      <label>{t("Amount · IDR", "Nominal · IDR")}<input autoFocus required name="amount" inputMode="decimal" maxLength={64} placeholder="3681341.75 / 30rb / 1,5jt" value={amount} onChange={e => setAmount(e.target.value)} /></label>
      <div className="form-row"><label>{t("Debit account", "Akun debit")}<select required value={debit} onChange={e => setDebit(e.target.value)}><option value="">{t("Choose account", "Pilih akun")}</option>{quickAccounts(kind, accounts, "debit").map(a => <option value={a.id} key={a.id}>{a.code} · {a.name}</option>)}</select></label>
      <label>{t("Credit account", "Akun kredit")}<select required value={credit} onChange={e => setCredit(e.target.value)}><option value="">{t("Choose account", "Pilih akun")}</option>{quickAccounts(kind, accounts, "credit").map(a => <option value={a.id} key={a.id}>{a.code} · {a.name}</option>)}</select></label></div>
      <p className="ledger-help">{kind === "expense" ? t("For debit/transfer choose a bank as the credit account. For credit/paylater choose a liability. Repay it later using Pay debt, so the expense is counted once.", "Untuk debit/transfer pilih bank sebagai akun kredit. Untuk kartu kredit/paylater pilih akun kewajiban. Pembayarannya dicatat lewat Bayar utang agar beban dihitung sekali.") : t("The selected accounts determine where the balance moves. Create a separate account for each lender, borrower, bank or card in Accounts.", "Akun menentukan perpindahan saldo. Buat akun terpisah untuk setiap pemberi pinjaman, peminjam, bank, atau kartu di halaman Akun.")}</p></>}
    {mode === "journal" && <><label>{t("Journal purpose", "Tujuan jurnal")}<select value={manualType} onChange={e => setManualType(e.target.value as "journal" | "closing")}><option value="journal">{t("General / adjustment", "Umum / penyesuaian")}</option><option value="closing">{t("Closing revenue / expenses to equity", "Penutup pendapatan / beban ke ekuitas")}</option></select></label><p className="ledger-help">{manualType === "closing" ? t("Use only revenue, expense and equity accounts. Closing entries and their reversals do not erase period profit in the income statement.", "Gunakan akun pendapatan, beban, dan ekuitas. Jurnal penutup beserta pembaliknya tidak menghapus laba periode pada laporan laba rugi.") : t("Post any balanced journal, including credit sales, unpaid bills, principal plus interest, accruals and adjustments. Enter the full split yourself; interest is not calculated automatically.", "Catat jurnal seimbang untuk penjualan kredit, tagihan belum dibayar, pokok beserta bunga, akrual, dan penyesuaian. Isi rinciannya sendiri; bunga tidak dihitung otomatis.")}</p><div className="journal-input-lines">{lines.map((line, index) => <div className="journal-input-line" key={line.key}><label>{t("Account", "Akun")} {index + 1}<select required aria-label={`${t("Account", "Akun")} ${index + 1}`} value={line.account} onChange={e => updateLine(line.key, "account", e.target.value)}><option value="">{t("Choose account", "Pilih akun")}</option>{accounts.map(a => <option value={a.id} key={a.id}>{a.code} · {a.name}</option>)}</select></label>
      <label>Debit<input inputMode="decimal" aria-label={`Debit ${index + 1}`} value={line.debit} placeholder="0" onChange={e => updateLine(line.key, "debit", e.target.value)} maxLength={64} /></label>
      <label>{t("Credit", "Kredit")}<input inputMode="decimal" aria-label={`${t("Credit", "Kredit")} ${index + 1}`} value={line.credit} placeholder="0" onChange={e => updateLine(line.key, "credit", e.target.value)} maxLength={64} /></label>
      <button className="cancel-button line-remove" disabled={lines.length <= 2} aria-label={t("Remove line", "Hapus baris")} onClick={() => setLines(previous => previous.filter(l => l.key !== line.key))} type="button">×</button></div>)}</div>
      <button className="secondary-button" disabled={lines.length >= 20} onClick={() => setLines(previous => [...previous, { key: crypto.randomUUID(), account: "", debit: "", credit: "" }])} type="button">＋ {t("Add line", "Tambah baris")}</button></>}
    <div className={`journal-balance ${balanced ? "is-balanced" : ""}`} aria-live="polite"><span>Debit <strong>{money.format(debitTotal)}</strong></span><span>{t("Credit", "Kredit")} <strong>{money.format(creditTotal)}</strong></span><span>{balanced ? t("Balanced", "Seimbang") : `${t("Difference", "Selisih")}: ${money.format(debitTotal - creditTotal)}`}</span></div>
    <label>{t("Description", "Keterangan")}<input required value={memo} onChange={e => setMemo(e.target.value)} maxLength={240} placeholder={t("Purpose, counterparty and notes", "Tujuan, nama pihak, dan catatan")} /></label>
    <div className="form-row"><label>{t("Category / label", "Kategori / label")}<input value={category} onChange={e => setCategory(e.target.value)} maxLength={60} list="journal-categories" /><datalist id="journal-categories">{["Gaji", "Freelance", "Makanan", "Belanja", "Transportasi", "Tagihan", "Kesehatan", "Pendidikan", "Administrasi", "Bunga", "Utang", "Piutang", "Lainnya"].map(c => <option key={c} value={c} />)}</datalist></label><label>{t("Date", "Tanggal")}<input type="date" required value={date} onChange={e => setDate(e.target.value)} /></label></div>
    {validation && <p role="alert" className="auth-feedback error-feedback">{validation}</p>}<LedgerStatus />
    <div className="modal-note">{t("Posted journals stay in the audit history. Use a reversal to correct a mistake.", "Jurnal tersimpan dalam riwayat. Gunakan jurnal pembalik untuk memperbaiki kesalahan.")}</div>
    <div className="modal-actions"><button className="cancel-button" disabled={saving} onClick={onClose} type="button">{t("Cancel", "Batal")}</button><button className="primary-button" disabled={saving || !balanced} type="submit">{saving ? t("Posting…", "Menyimpan…") : t("Post journal", "Simpan jurnal")}</button></div>
  </form></LedgerModal>;
}
