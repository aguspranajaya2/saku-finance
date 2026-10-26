export type ReceiptCandidate = {
  merchant: string;
  amount: number | null;
  date: string | null;
  confidence: number;
};

function parseDate(text: string) {
  const match = text.match(/\b(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})\b/);
  if (!match) return null;

  let year: number;
  let month: number;
  let day: number;
  if (match[1].length === 4) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else {
    day = Number(match[1]);
    month = Number(match[2]);
    year = Number(match[3]);
    if (year < 100) year += year < 70 ? 2000 : 1900;
  }

  const parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function amountsOnLine(line: string) {
  const matches = [...line.matchAll(/(?:rp\.?\s*)?(\d{1,3}(?:[.,\s]\d{3})+|\d{4,})/gi)];
  return matches.map((match) => Number(match[1].replace(/\D/g, ""))).filter((amount) => Number.isSafeInteger(amount) && amount > 0);
}

export function parseReceipt(text: string, confidence: number): ReceiptCandidate {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const totalLines = lines.filter((line) => /\b(total|grand\s*total|jumlah\s*bayar|total\s*bayar|tagihan)\b/i.test(line) && !/sub.?total|total\s*item/i.test(line));
  const preferredAmounts = totalLines.flatMap(amountsOnLine);
  const fallbackAmounts = lines
    .filter((line) => !/tanggal|date|telp|phone|kasir|cashier|kembalian|change|diskon|discount|qty|no\.?\s*(nota|struk|invoice)/i.test(line))
    .flatMap(amountsOnLine);
  const amounts = preferredAmounts.length ? preferredAmounts : fallbackAmounts;

  const merchant = lines.find((line) => /[a-zA-ZÀ-ÿ]{3,}/.test(line) && !/^(struk|nota|receipt|tanggal|date|no\.?\s*(nota|struk|invoice))/i.test(line))?.slice(0, 70) ?? "Belanja";
  const parsedDate = lines.map(parseDate).find(Boolean) ?? null;
  const parsedConfidence = Number.isFinite(confidence) ? Math.max(0, Math.min(100, confidence)) : 0;

  return {
    merchant,
    amount: amounts.length ? Math.max(...amounts) : null,
    date: parsedDate,
    confidence: Math.round(parsedConfidence),
  };
}
