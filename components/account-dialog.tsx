"use client";
import { useState, type FormEvent } from "react";
import { useLedger } from "@/components/ledger-provider";
import { LedgerModal, LedgerStatus, useLedgerText } from "@/components/ledger-ui";
import { accountTypeLabel, accountTypes, todayDate, type AccountRole, type AccountType, type JournalEntry, type LedgerAccount } from "@/lib/ledger";
import { parseRupiahAmount, exactRupiah, minorToRupiah } from "@/lib/money";

const roles: Record<AccountType, Array<[AccountRole, string, string]>> = {
  asset: [["general", "Other asset", "Aset lain"], ["cash", "Cash", "Kas"], ["bank", "Bank / e-wallet", "Bank / dompet digital"], ["receivable", "Receivable / borrower", "Piutang / peminjam"]],
  liability: [["payable", "Payable / lender", "Utang / pemberi pinjaman"], ["credit_card", "Credit card / paylater", "Kartu kredit / paylater"], ["general", "Other liability", "Kewajiban lain"]],
  equity: [["general", "Equity / retained earnings / drawings", "Modal / laba ditahan / prive"]], revenue: [["general", "Revenue", "Pendapatan"]], expense: [["general", "Expense", "Beban"]],
};
function openingAmount(value: string) { if (!value.trim() || /^-?0+(?:[.,]0{1,2})?$/.test(value.trim())) return 0; const negative = value.trim().startsWith("-"); const amount = parseRupiahAmount(negative ? value.trim().slice(1) : value); return amount === null ? null : negative ? minorToRupiah(-exactRupiah(amount)) : amount; }
export function AccountDialog({ onClose }: { onClose: () => void }) {
  const { createAccount, saving } = useLedger(); const { t, language } = useLedgerText();
  const [type, setType] = useState<AccountType>("asset"), [role, setRole] = useState<AccountRole>("bank"), [validation, setValidation] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const data = new FormData(e.currentTarget); const amount = openingAmount(String(data.get("opening") ?? ""));
    if (amount === null) { setValidation(t("Use an opening balance with up to two decimals.", "Isi saldo awal dengan maksimal dua desimal.")); return; }
    if (await createAccount({ code: String(data.get("code")).trim(), name: String(data.get("name")).trim(), type, role,
      openingBalance: type === "asset" || type === "liability" ? amount : 0, openingDate: String(data.get("date") ?? todayDate()) })) onClose();
  }
  return <LedgerModal title={t("Create an account", "Buat akun pembukuan")} onClose={onClose} busy={saving}><form className="transaction-form" onSubmit={submit}>
    <p className="ledger-help">{t("Separate accounts make each bank, lender, borrower or cost easy to track. Example: 1110 Receivable — Budi, or 2010 Loan — Rina.", "Akun terpisah memudahkan pelacakan setiap bank, pemberi pinjaman, peminjam, atau beban. Contoh: 1110 Piutang Budi atau 2010 Utang Rina.")}</p>
    <div className="form-row"><label>{t("Account code", "Kode akun")}<input name="code" required pattern="[0-9]{3,12}" inputMode="numeric" maxLength={12} placeholder="1110" /></label><label>{t("Type", "Jenis")}<select value={type} onChange={e => { const value = e.target.value as AccountType; setType(value); setRole(roles[value][0][0]); }}>{accountTypes.map(a => <option value={a} key={a}>{accountTypeLabel(a, language)}</option>)}</select></label></div>
    <label>{t("Account name", "Nama akun")}<input name="name" required maxLength={100} placeholder={t("e.g. Receivable — Budi", "Contoh: Piutang Budi")} /></label>
    <label>{t("Account detail", "Rincian akun")}<select value={role} onChange={e => setRole(e.target.value as AccountRole)}>{roles[type].map(([value, en, id]) => <option value={value} key={value}>{t(en, id)}</option>)}</select></label>
    {(type === "asset" || type === "liability") && <><div className="form-row"><label>{t("Opening balance (optional)", "Saldo awal (opsional)")}<input name="opening" inputMode="decimal" maxLength={64} placeholder="0" /></label><label>{t("Opening date", "Tanggal saldo awal")}<input name="date" type="date" required defaultValue={todayDate()} /></label></div><p className="ledger-help">{t("Positive means a normal asset or debt balance. An opening journal is posted against equity; it is excluded from revenue and expenses.", "Angka positif berarti saldo aset atau utang normal. Saldo awal dibuat sebagai jurnal dengan lawan ekuitas, terpisah dari pendapatan dan beban.")}</p></>}
    {validation && <p role="alert" className="auth-feedback error-feedback">{validation}</p>}<LedgerStatus />
    <div className="modal-actions"><button className="cancel-button" disabled={saving} onClick={onClose} type="button">{t("Cancel", "Batal")}</button><button className="primary-button" disabled={saving} type="submit">{saving ? t("Saving…", "Menyimpan…") : t("Create account", "Buat akun")}</button></div>
  </form></LedgerModal>;
}
export function OpeningDialog({ account, onClose }: { account: LedgerAccount; onClose: () => void }) {
  const { entries, recordOpening, saving } = useLedger(); const { t } = useLedgerText(); const [validation, setValidation] = useState("");
  const first = entries.filter(e => e.journal_lines.some(l => l.account_id === account.id)).map(e => e.entry_date).sort()[0] ?? todayDate();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const data = new FormData(e.currentTarget); const amount = openingAmount(String(data.get("amount")));
    if (!amount) { setValidation(t("Enter a non-zero amount with up to two decimals.", "Isi nominal selain nol, maksimal dua desimal.")); return; }
    if (await recordOpening(account, amount, String(data.get("date")))) onClose();
  }
  return <LedgerModal title={t("Record opening balance", "Catat saldo awal")} onClose={onClose} busy={saving}><form className="transaction-form" onSubmit={submit}>
    <strong>{account.code} · {account.name}</strong><p className="ledger-help">{t("Enter this account's balance before its first transaction. This adds a starting balance, not a replacement for today's balance. Reverse an existing opening journal before correcting it.", "Isi saldo akun sebelum transaksi pertamanya. Ini menambahkan saldo awal, bukan mengganti saldo hari ini. Balik jurnal saldo awal sebelumnya untuk mengoreksinya.")}</p>
    <label>{t("Opening balance", "Saldo awal")}<input name="amount" required inputMode="decimal" maxLength={64} placeholder="1000000" /></label><label>{t("Date on or before first activity", "Tanggal sebelum atau sama dengan aktivitas pertama")}<input name="date" required type="date" defaultValue={first} max={first} /></label>
    {validation && <p className="auth-feedback error-feedback" role="alert">{validation}</p>}<LedgerStatus /><div className="modal-actions"><button className="cancel-button" disabled={saving} onClick={onClose} type="button">{t("Cancel", "Batal")}</button><button className="primary-button" disabled={saving} type="submit">{t("Post opening balance", "Simpan saldo awal")}</button></div>
  </form></LedgerModal>;
}
export function ReverseDialog({ entry, onClose }: { entry: JournalEntry; onClose: () => void }) {
  const { reverseEntry, saving } = useLedger(); const { t } = useLedgerText();
  async function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); if (await reverseEntry(entry.id, String(new FormData(e.currentTarget).get("date")))) onClose(); }
  return <LedgerModal title={t("Reverse journal", "Balik jurnal")} onClose={onClose} busy={saving}><form className="transaction-form" onSubmit={submit}><strong>{entry.memo}</strong><p className="ledger-help">{t("This creates an equal, opposite journal. The original entry stays in your records. To correct a mistake, post the replacement entry afterwards.", "Ini membuat jurnal dengan debit/kredit terbalik dan nominal yang sama. Jurnal asli tetap tersimpan. Untuk koreksi, buat jurnal pengganti setelahnya.")}</p>
      <label>{t("Reversal date", "Tanggal pembalik")}<input name="date" type="date" min={entry.entry_date} defaultValue={entry.entry_date} required /></label><p className="ledger-help">{t("For an input error, use the original date to cancel its effect in the same period. After the reversal succeeds, record the correct activity once. Reversing alone removes the incorrect amount from balances.", "Untuk kesalahan input, gunakan tanggal asli agar dampaknya dibatalkan pada periode yang sama. Setelah pembalik berhasil, catat aktivitas yang benar satu kali. Pembalik saja sudah menetralkan nominal yang salah dari saldo.")}</p><LedgerStatus />
    <div className="modal-actions"><button className="cancel-button" disabled={saving} onClick={onClose} type="button">{t("Cancel", "Batal")}</button><button className="primary-button" disabled={saving} type="submit">{t("Post reversal", "Simpan pembalik")}</button></div></form></LedgerModal>;
}
