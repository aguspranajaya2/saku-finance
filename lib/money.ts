/** Parse whole IDR without stripping unknown characters or rounding cents. */
export function parseRupiahAmount(input: string): number | null {
  if (input.length > 64) return null;
  const value = input.trim().toLowerCase().replace(/^rp\.?\s*/, "");
  const match = value.match(/^(\d+(?:[.,]\d{1,2})?)\s*(ribu|rb|k|juta|jt|miliar|milyar)?$/);
  let amount: bigint;
  if (match?.[2]) {
    const multiplier = ["ribu", "rb", "k"].includes(match[2]) ? 1000n : ["juta", "jt"].includes(match[2]) ? 1000000n : 1000000000n;
    const [whole, fraction = ""] = match[1].split(/[.,]/);
    const denominator = 10n ** BigInt(fraction.length);
    const scaled = BigInt(whole + fraction) * multiplier;
    if (scaled % denominator !== 0n) return null;
    amount = scaled / denominator;
  } else if (/^\d+$/.test(value)) amount = BigInt(value);
  else if (/^\d{1,3}(?:\.\d{3})+$/.test(value) || /^\d{1,3}(?:,\d{3})+$/.test(value)) amount = BigInt(value.replace(/[.,]/g, ""));
  else return null;
  return amount > 0n && amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : null;
}

export function exactRupiah(value: unknown): bigint {
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^-?\d+$/.test(value) && value.length < 80) return BigInt(value);
  throw new Error("Invalid rupiah balance.");
}
