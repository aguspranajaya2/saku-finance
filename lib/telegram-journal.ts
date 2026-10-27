import { parseRupiahAmount } from "@/lib/money";
import type { EntryType } from "@/lib/ledger";

const aliases: Record<string, { type: EntryType; debit: string; credit: string; legacy?: "income" | "expense" }> = {
  pemasukan: { type: "income", debit: "1000", credit: "4000", legacy: "income" },
  pengeluaran: { type: "expense", debit: "5000", credit: "1000", legacy: "expense" },
  utang: { type: "borrow", debit: "1000", credit: "2000" }, piutang: { type: "lend", debit: "1100", credit: "1000" },
  bayar_utang: { type: "repay_debt", debit: "2000", credit: "1000" }, terima_piutang: { type: "collect_receivable", debit: "1000", credit: "1100" },
  kartu_debit: { type: "expense", debit: "5000", credit: "1010" }, kartu_kredit: { type: "expense", debit: "5000", credit: "2100" },
  bayar_kartu: { type: "repay_debt", debit: "2100", credit: "1010" }, transfer: { type: "transfer", debit: "1010", credit: "1000" },
  modal: { type: "journal", debit: "1000", credit: "3000" }, prive: { type: "journal", debit: "3000", credit: "1000" },
};
const synonyms: Record<string, string> = { masuk: "pemasukan", income: "pemasukan", keluar: "pengeluaran", expense: "pengeluaran", hutang: "utang", borrow: "utang", lend: "piutang", cicilan: "bayar_utang", bayar_hutang: "bayar_utang", repay_debt: "bayar_utang", collect_receivable: "terima_piutang", paylater: "kartu_kredit" };
export type TelegramJournalCommand = { type: EntryType; debit: string; credit: string; amount: number; category: string; memo: string; legacy?: "income" | "expense" };
export function parseTelegramJournal(text: string): TelegramJournalCommand | "invalid_amount" | "invalid_format" | null {
  if (/^\/jurnal(?:@\w+)?(?:\s|$)/i.test(text)) {
    const match = text.match(/^\/jurnal(?:@\w+)?\s+(\d{3,12})\s+(\d{3,12})\s+(\S+)(?:\s+(ribu|rb|k|juta|jt|miliar|milyar))?\s+(.+)$/i);
    if (!match || match[1] === match[2]) return "invalid_format";
    const amount = parseRupiahAmount(match[3] + (match[4] ?? "")); if (amount === null) return "invalid_amount";
    return { type: "journal", debit: match[1], credit: match[2], amount, category: "Jurnal", memo: match[5].trim().slice(0, 240) };
  }
  if (!/^\/catat(?:@\w+)?(?:\s|$)/i.test(text)) return null;
  const match = text.match(/^\/catat(?:@\w+)?\s+(\S+)\s+(\S+)(?:\s+(ribu|rb|k|juta|jt|miliar|milyar))?\s+(\S+)(?:\s+(.+))?$/i);
  if (!match) return "invalid_format";
  const key = match[1].toLowerCase(), preset = aliases[synonyms[key] ?? key];
  if (!preset) return "invalid_format";
  const amount = parseRupiahAmount(match[2] + (match[3] ?? "")); if (amount === null) return "invalid_amount";
  const category = match[4].replace(/_/g, " ").slice(0, 60);
  return { ...preset, amount, category, memo: (match[5]?.trim() || category).slice(0, 240) };
}
