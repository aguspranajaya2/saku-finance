/** Public money is decimal rupiah; all calculations use bigint hundredths. */
export type Rupiah = number | string;
export const MAX_MINOR = 900719925474099100n;
export function minorToRupiah(value: bigint): Rupiah {
  if (value % 100n === 0n && value / 100n <= BigInt(Number.MAX_SAFE_INTEGER) && value / 100n >= BigInt(Number.MIN_SAFE_INTEGER)) return Number(value / 100n);
  const abs = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}
/** Only safe integer numbers or exact decimal strings are accepted from APIs. */
export function exactRupiah(value: unknown): bigint {
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value) * 100n;
  if (typeof value === "string" && value.length < 80 && /^-?\d+(?:\.\d{1,2})?$/.test(value)) {
    const negative = value.startsWith("-"), [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
    const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
    return negative ? -minor : minor;
  }
  throw new Error("Invalid exact rupiah amount.");
}
export function validRupiah(value: unknown) {
  try { const minor = exactRupiah(value); return minor >= -MAX_MINOR && minor <= MAX_MINOR; } catch { return false; }
}
/** Recognize Indonesian/English grouping and up to two decimals; never round. */
export function parseRupiahAmount(input: string): Rupiah | null {
  if (input.length > 64) return null;
  const value = input.trim().toLowerCase().replace(/^rp\.?\s*/, "");
  const match = value.match(/^(\d+(?:[.,]\d{1,2})?)\s*(ribu|rb|k|juta|jt|miliar|milyar)?$/);
  let amount: bigint;
  if (match?.[2]) {
    const multiplier = ["ribu", "rb", "k"].includes(match[2]) ? 1000n : ["juta", "jt"].includes(match[2]) ? 1000000n : 1000000000n;
    const [whole, fraction = ""] = match[1].split(/[.,]/);
    const denominator = 10n ** BigInt(fraction.length);
    const scaled = BigInt(whole + fraction) * multiplier * 100n;
    if (scaled % denominator !== 0n) return null;
    amount = scaled / denominator;
  } else {
    let decimal: string;
    if (/^\d+$/.test(value)) decimal = value;
    else if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(value)) decimal = value.replace(/\./g, "").replace(",", ".");
    else if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(value)) decimal = value.replace(/,/g, "");
    else if (/^\d+[.,]\d{1,2}$/.test(value)) decimal = value.replace(",", ".");
    else return null;
    amount = exactRupiah(decimal);
  }
  return amount > 0n && amount <= MAX_MINOR ? minorToRupiah(amount) : null;
}
/** Format bigint hundredths, or decimal rupiah, without a floating point conversion. */
export function formatRupiah(value: Rupiah | bigint, language: "en" | "id" = "id", hidden = false): string {
  if (hidden) return "IDR ••••••";
  const minor = typeof value === "bigint" ? value : exactRupiah(value);
  const abs = minor < 0n ? -minor : minor;
  const formatter = new Intl.NumberFormat(language === "en" ? "en-US" : "id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const parts = formatter.formatToParts(minor < 0n ? -(abs / 100n) : abs / 100n);
  const result = parts.map(part => part.type === "fraction" ? String(abs % 100n).padStart(2, "0") : part.value).join("");
  return minor < 0n && abs < 100n ? `-${result}` : result;
}
