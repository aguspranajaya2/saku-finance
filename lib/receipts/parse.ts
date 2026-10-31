import { exactRupiah, parseRupiahAmount, type Rupiah } from "@/lib/money";

export type ReceiptCandidate = {
  kind: "receipt" | "bank_transfer";
  merchant: string;
  amount: Rupiah | null;
  date: string | null;
  confidence: number;
  issue: "amount_not_found" | "ambiguous_amount" | "unsupported_currency" | "unsuccessful" | null;
};

const months = ["jan(?:uary|uari)?", "feb(?:ruary|ruari)?", "mar(?:ch|et)?", "apr(?:il)?", "may|mei", "jun(?:e|i)?", "jul(?:y|i)?", "aug(?:ust)?|agu(?:stus)?", "sep(?:tember)?", "oct(?:ober)?|okt(?:ober)?", "nov(?:ember)?", "dec(?:ember)?|des(?:ember)?"];
function validDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function parseDate(text: string) {
  const numeric = text.match(/\b(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})\b/);
  if (numeric) {
    const iso = numeric[1].length === 4;
    let year = Number(iso ? numeric[1] : numeric[3]);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    return validDate(year, Number(numeric[2]), Number(iso ? numeric[3] : numeric[1]));
  }
  const named = text.match(new RegExp(`\\b(\\d{1,2})\\s+(${months.join("|")})\\.?\\s+(\\d{4})\\b`, "i"));
  if (!named) return null;
  const month = months.findIndex(pattern => new RegExp(`^(?:${pattern})$`, "i").test(named[2])) + 1;
  return validDate(Number(named[3]), month, Number(named[1]));
}

// Account/reference identifiers are never money, even if OCR inserts spaces.
const identifiers = /beneficiary\s*(account|name)|rekening|account\s*(no|number)|reference|referensi|source\s*(of\s*fund|currency)|transfer\s*currency|transaction\s*(id|type)|nomor|\b(telp|phone|kasir|cashier|tanggal|date|kembalian|change|diskon|discount|qty)\b|no\.?\s*(nota|struk|invoice)/i;
const currency = /\b(?:IDR|Rp)\.?\s*\d/i;
function amountsOnLine(line: string) {
  const separated = line.replace(/\b(?:IDR|Rp)\.?\s*(?=\d)/gi, " ");
  const matches = [...separated.matchAll(/(?<![\w])\d+(?:[.,]\d+)*(?:\s\d{3}(?!\d))*(?:[.,]\d+)?(?![\w])/g)];
  return matches.map(match => parseRupiahAmount(match[0].replace(/\s/g, "")))
    .filter((amount): amount is Rupiah => amount !== null);
}
function distinct(amounts: Rupiah[]) {
  return [...new Map(amounts.map(value => [exactRupiah(value), value])).values()];
}
function labelledAmounts(lines: string[], label: RegExp) {
  return lines.flatMap((line, index) => {
    if (!label.test(line) || identifiers.test(line)) return [];
    const tail = line.replace(label, "").replace(/^[\s:=-]+/, "");
    // A malformed labelled value must not fall back to a different number.
    if (/\d/.test(tail)) return amountsOnLine(tail);
    const next = lines[index + 1] ?? "";
    return /^(?:(?:IDR|Rp)\.?\s*)?\d[\d.,\s]*$/i.test(next) ? amountsOnLine(next) : [];
  });
}

export function parseReceipt(text: string, confidence: number): ReceiptCandidate {
  const lines = text.split(/\r?\n/).map(line => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const bank = /\b(transfer\s*(successful|success|berhasil|amount|to|failed|pending|gagal|tertunda)|bukti\s*transfer|beneficiary|penerima)\b/i.test(text);
  const label = bank ? /\b(?:transfer\s*amount|nominal\s*transfer|jumlah\s*transfer)\b/i
    : /\b(?:grand\s*total|total\s*bayar|jumlah\s*bayar|total|tagihan)\b/i;
  const eligible = lines.filter(line => !/sub.?total|total\s*item/i.test(line));
  const hasLabel = eligible.some(line => label.test(line) && !identifiers.test(line));
  const preferred = labelledAmounts(eligible, label);
  // Fallback requires an explicit rupiah currency. Never choose the largest
  // arbitrary number in a document (it may be a bank reference or account).
  const fallback = lines.filter(line => !identifiers.test(line) && currency.test(line)).flatMap(amountsOnLine);
  const amounts = distinct(hasLabel ? preferred : fallback);
  const recipientIndex = lines.findIndex(line => /^(?:beneficiary\s*name|nama\s*penerima)\b/i.test(line));
  const recipientLine = recipientIndex < 0 ? "" : lines[recipientIndex].replace(/^(?:beneficiary\s*name|nama\s*penerima)\s*:?[\s]*/i, "");
  const recipient = recipientLine || (recipientIndex >= 0 && !identifiers.test(lines[recipientIndex + 1] ?? "") ? lines[recipientIndex + 1] : "");
  const merchant = bank ? (recipient ? `Transfer ke ${recipient}` : "Transfer bank")
    : lines.find(line => /[a-zA-ZÀ-ÿ]{3,}/.test(line) && !identifiers.test(line) && !/^(struk|nota|receipt|total|grand\s*total)\b/i.test(line)) ?? "Belanja";
  const unsuccessful = bank && /\b(failed|unsuccessful|pending|processing|gagal|tertunda|diproses)\b/i.test(text);
  const foreign = /\b(?:USD|SGD|MYR|EUR|GBP|JPY|AUD|CNY|HKD|THB)\b/i.test(text);
  const issue = unsuccessful ? "unsuccessful" : foreign ? "unsupported_currency" : amounts.length > 1 ? "ambiguous_amount" : !amounts.length ? "amount_not_found" : null;
  return {
    kind: bank ? "bank_transfer" : "receipt", merchant: merchant.slice(0, 70),
    amount: issue ? null : amounts[0],
    date: lines.filter(line => !identifiers.test(line) || /tanggal|date/i.test(line)).map(parseDate).find(Boolean) ?? null,
    confidence: Math.round(Number.isFinite(confidence) ? Math.max(0, Math.min(100, confidence)) : 0), issue,
  };
}
