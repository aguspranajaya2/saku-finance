export type Language = "en" | "id";
export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";
export type AccountRole = "general" | "cash" | "bank" | "receivable" | "payable" | "credit_card" | "opening_equity";
export type EntryType = "income" | "expense" | "borrow" | "lend" | "repay_debt" | "collect_receivable" | "transfer" | "opening" | "journal" | "closing" | "reversal";
export type QuickKind = Exclude<EntryType, "opening" | "journal" | "closing" | "reversal"> | "capital" | "withdrawal";
export type LedgerAccount = { id: string; code: string; name: string; account_type: AccountType; role: AccountRole };
export type JournalLine = { account_id: string; debit: number; credit: number; line_no?: number };
export type JournalEntry = { id: string; entry_date: string; memo: string; entry_type: EntryType; category: string; source: string; created_at: string; reversal_of: string | null; reversed_by: string | null; journal_lines: JournalLine[] };
export type NewJournal = { date: string; memo: string; type: EntryType; category: string; lines: JournalLine[]; requestId: string };
export type NewAccount = { code: string; name: string; type: AccountType; role: AccountRole; openingBalance: number; openingDate: string };
export const accountTypes: AccountType[] = ["asset", "liability", "equity", "revenue", "expense"];
export const quickKinds: QuickKind[] = ["income", "expense", "borrow", "lend", "repay_debt", "collect_receivable", "transfer", "capital", "withdrawal"];
const typeLabels: Record<string, [string, string]> = {
  asset: ["Assets", "Aset"], liability: ["Liabilities", "Kewajiban"], equity: ["Equity", "Ekuitas"], revenue: ["Revenue", "Pendapatan"], expense: ["Expenses", "Beban"],
};
const entryLabels: Record<string, [string, string]> = {
  income: ["Income", "Pemasukan"], expense: ["Expense / purchase", "Pengeluaran / belanja"], borrow: ["Borrow money", "Terima pinjaman"],
  lend: ["Lend money", "Berikan pinjaman"], repay_debt: ["Pay debt / installment", "Bayar utang / cicilan"], collect_receivable: ["Collect receivable", "Terima pelunasan piutang"],
  transfer: ["Own-account transfer", "Transfer antar rekening sendiri"], capital: ["Capital contribution", "Setoran modal"], withdrawal: ["Owner withdrawal", "Penarikan modal / prive"],
  opening: ["Opening balance", "Saldo awal"], journal: ["General journal", "Jurnal umum"], closing: ["Closing entry", "Jurnal penutup"], reversal: ["Reversal", "Jurnal pembalik"],
};
export const accountTypeLabel = (type: AccountType, language: Language) => typeLabels[type][language === "en" ? 0 : 1];
export const entryTypeLabel = (type: EntryType | QuickKind, language: Language) => entryLabels[type]?.[language === "en" ? 0 : 1] ?? type;
export function todayDate() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Makassar", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  return ["year", "month", "day"].map(type => parts.find(p => p.type === type)?.value).join("-");
}
export function normalizeEntry(raw: JournalEntry): JournalEntry {
  return { ...raw, journal_lines: raw.journal_lines.map(line => ({ ...line, debit: Number(line.debit), credit: Number(line.credit) })).sort((a, b) => (a.line_no ?? 0) - (b.line_no ?? 0)) };
}
export function isCash(account: LedgerAccount) { return account.role === "cash" || account.role === "bank"; }
export function debitNormal(type: AccountType) { return type === "asset" || type === "expense"; }
export function journalTotal(entry: JournalEntry) { return entry.journal_lines.reduce((sum, line) => sum + BigInt(line.debit), 0n); }
export function validateJournal(lines: JournalLine[]) {
  if (lines.length < 2 || lines.length > 20 || new Set(lines.map(l => l.account_id)).size < 2) return false;
  if (lines.some(l => !l.account_id || !Number.isSafeInteger(l.debit) || !Number.isSafeInteger(l.credit)
    || l.debit < 0 || l.credit < 0 || !((l.debit > 0 && l.credit === 0) || (l.credit > 0 && l.debit === 0)))) return false;
  const debit = lines.reduce((s, l) => s + BigInt(l.debit), 0n);
  return debit <= BigInt(Number.MAX_SAFE_INTEGER) && debit === lines.reduce((s, l) => s + BigInt(l.credit), 0n);
}
export function accountBalances(accounts: LedgerAccount[], entries: JournalEntry[], until?: string) {
  const movements = new Map<string, { debit: bigint; credit: bigint }>();
  for (const entry of entries) if (!until || entry.entry_date <= until) for (const line of entry.journal_lines) {
    const current = movements.get(line.account_id) ?? { debit: 0n, credit: 0n };
    current.debit += BigInt(line.debit); current.credit += BigInt(line.credit); movements.set(line.account_id, current);
  }
  return accounts.map(account => {
    const { debit, credit } = movements.get(account.id) ?? { debit: 0n, credit: 0n };
    const netDebit = debit - credit;
    return { ...account, debit, credit, netDebit, balance: debitNormal(account.account_type) ? netDebit : -netDebit };
  });
}
export function entryEffects(accounts: LedgerAccount[], entry: JournalEntry) {
  const byId = new Map(accounts.map(a => [a.id, a]));
  return entry.journal_lines.reduce((result, line) => {
    const account = byId.get(line.account_id); if (!account) return result;
    const movement = BigInt(line.debit) - BigInt(line.credit);
    if (account.account_type === "revenue") result.income -= movement;
    if (account.account_type === "expense") result.expense += movement;
    if (isCash(account)) result.cash += movement;
    return result;
  }, { income: 0n, expense: 0n, cash: 0n });
}
export function periodSummary(accounts: LedgerAccount[], entries: JournalEntry[], start: string, end: string) {
  const openingIds = new Set(entries.filter(e => e.entry_type === "opening").map(e => e.id));
  const closingIds = new Set(entries.filter(e => e.entry_type === "closing").map(e => e.id));
  return entries.filter(e => e.entry_date >= start && e.entry_date <= end).reduce((sum, entry) => {
    const effect = entryEffects(accounts, entry);
    if (entry.entry_type !== "closing" && !closingIds.has(entry.reversal_of ?? "")) { sum.income += effect.income; sum.expense += effect.expense; }
    // Opening balances describe a starting position, not a period's cash flow.
    if (entry.entry_type !== "opening" && !openingIds.has(entry.reversal_of ?? "")) { sum.cashIn += effect.cash > 0n ? effect.cash : 0n; sum.cashOut += effect.cash < 0n ? -effect.cash : 0n; }
    return sum;
  }, { income: 0n, expense: 0n, cashIn: 0n, cashOut: 0n });
}
export function incomeStatementEntries(entries: JournalEntry[], start: string, end: string) {
  const closingIds = new Set(entries.filter(e => e.entry_type === "closing").map(e => e.id));
  return entries.filter(e => e.entry_date >= start && e.entry_date <= end && e.entry_type !== "closing" && !closingIds.has(e.reversal_of ?? ""));
}
export function balanceSheet(accounts: LedgerAccount[], entries: JournalEntry[], until: string) {
  const balances = accountBalances(accounts, entries, until);
  const total = (type: AccountType) => balances.filter(a => a.account_type === type).reduce((s, a) => s + a.balance, 0n);
  const assets = total("asset"), liabilities = total("liability"), equity = total("equity"), earnings = total("revenue") - total("expense");
  const trialDebit = balances.reduce((s, a) => s + (a.netDebit > 0n ? a.netDebit : 0n), 0n);
  const trialCredit = balances.reduce((s, a) => s + (a.netDebit < 0n ? -a.netDebit : 0n), 0n);
  return { balances, assets, liabilities, equity, earnings, trialDebit, trialCredit, difference: assets - liabilities - equity - earnings };
}
export function quickAccounts(kind: QuickKind, accounts: LedgerAccount[], side: "debit" | "credit") {
  return accounts.filter(a => {
    switch (kind) {
      case "income": return side === "debit" ? isCash(a) : a.account_type === "revenue";
      case "expense": return side === "debit" ? a.account_type === "expense" : isCash(a) || a.account_type === "liability";
      case "borrow": return side === "debit" ? isCash(a) : a.account_type === "liability";
      case "lend": return side === "debit" ? a.role === "receivable" : isCash(a);
      case "repay_debt": return side === "debit" ? a.account_type === "liability" : isCash(a);
      case "collect_receivable": return side === "debit" ? isCash(a) : a.role === "receivable";
      case "transfer": return isCash(a);
      case "capital": return side === "debit" ? isCash(a) : a.account_type === "equity";
      case "withdrawal": return side === "debit" ? a.account_type === "equity" : isCash(a);
    }
  });
}
export function accountLedger(account: LedgerAccount, entries: JournalEntry[], until: string) {
  let running = 0n;
  return [...entries].filter(e => e.entry_date <= until && e.journal_lines.some(l => l.account_id === account.id))
    .sort((a, b) => a.entry_date.localeCompare(b.entry_date) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .map(entry => {
      const lines = entry.journal_lines.filter(l => l.account_id === account.id);
      const debit = lines.reduce((s, l) => s + BigInt(l.debit), 0n), credit = lines.reduce((s, l) => s + BigInt(l.credit), 0n);
      running += debitNormal(account.account_type) ? debit - credit : credit - debit;
      return { entry, debit, credit, running };
    });
}

const presets: Array<[string, string, AccountType, AccountRole]> = [
  ["1000", "Kas / Cash", "asset", "cash"], ["1010", "Bank", "asset", "bank"], ["1100", "Piutang / Receivables", "asset", "receivable"],
  ["2000", "Utang / Payables", "liability", "payable"], ["2100", "Kartu kredit / Credit card", "liability", "credit_card"],
  ["3000", "Modal awal / Opening equity", "equity", "opening_equity"], ["4000", "Pendapatan / Revenue", "revenue", "general"], ["5000", "Beban / Expenses", "expense", "general"],
];
export const demoAccounts: LedgerAccount[] = presets.map(([code, name, account_type, role]) => ({ id: `demo-${code}`, code, name, account_type, role }));
export function demoJournal(): JournalEntry[] {
  const day = todayDate();
  const records: Array<[EntryType, string, string, string, number, string]> = [
    ["opening", "Opening cash / Saldo awal kas", "1000", "3000", 1000000, "Saldo awal"],
    ["income", "Salary / Gaji", "1010", "4000", 8000000, "Gaji"],
    ["borrow", "Bank loan / Pinjaman bank", "1010", "2000", 2000000, "Utang"],
    ["expense", "Credit card shopping / Belanja kartu kredit", "5000", "2100", 500000, "Belanja"],
    ["repay_debt", "Card installment / Cicilan kartu", "2100", "1010", 100000, "Utang"],
    ["lend", "Loan to a friend / Pinjaman ke teman", "1100", "1000", 300000, "Piutang"],
    ["collect_receivable", "Partial repayment / Angsuran piutang", "1000", "1100", 100000, "Piutang"],
    ["expense", "Lunch / Makan siang", "5000", "1000", 30000, "Makanan"],
  ];
  return records.map(([entry_type, memo, dr, cr, amount, category], index) => ({
    id: `demo-entry-${index}`, entry_date: day, created_at: `${day}T08:00:${String(index).padStart(2, "0")}Z`, memo, entry_type, category,
    source: "web", reversed_by: null, reversal_of: null,
    journal_lines: [{ account_id: `demo-${dr}`, debit: amount, credit: 0, line_no: 1 }, { account_id: `demo-${cr}`, debit: 0, credit: amount, line_no: 2 }],
  }));
}
