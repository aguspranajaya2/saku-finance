export type EntryKind = "income" | "expense";

export type Transaction = {
  id: string | number;
  title: string;
  idTitle?: string;
  category: string;
  date: string;
  amount: number;
  kind: EntryKind;
  emoji: string;
};

export type NewTransaction = Omit<Transaction, "id" | "emoji" | "idTitle">;

export type DatabaseTransaction = {
  id: string;
  description: string;
  category: string;
  transaction_date: string;
  amount: number | string;
  kind: EntryKind;
};

export const demoTransactions: Transaction[] = [
  { id: 1, title: "Monthly salary", idTitle: "Gaji bulanan", category: "Gaji", date: "2026-10-25", amount: 8000000, kind: "income", emoji: "💼" },
  { id: 2, title: "Monthly groceries", idTitle: "Belanja bulanan", category: "Belanja", date: "2026-10-24", amount: 1250000, kind: "expense", emoji: "🛍️" },
  { id: 3, title: "Lunch", idTitle: "Makan siang", category: "Makanan", date: "2026-10-24", amount: 45000, kind: "expense", emoji: "🍜" },
  { id: 4, title: "Transfer from Rina", idTitle: "Transfer dari Rina", category: "Lainnya", date: "2026-10-22", amount: 3000000, kind: "income", emoji: "↩️" },
  { id: 5, title: "Electricity bill", idTitle: "Tagihan listrik", category: "Tagihan", date: "2026-10-21", amount: 385000, kind: "expense", emoji: "⚡" },
  { id: 6, title: "Coffee", idTitle: "Kopi", category: "Makanan", date: "2026-10-20", amount: 28000, kind: "expense", emoji: "☕" },
  { id: 7, title: "Design freelance", idTitle: "Freelance desain", category: "Freelance", date: "2026-10-18", amount: 1450000, kind: "income", emoji: "✨" },
  { id: 8, title: "Transport", idTitle: "Transportasi", category: "Transportasi", date: "2026-10-17", amount: 220000, kind: "expense", emoji: "🛵" },
  { id: 9, title: "Music subscription", idTitle: "Langganan musik", category: "Hiburan", date: "2026-10-15", amount: 55000, kind: "expense", emoji: "🎧" },
  { id: 10, title: "Medicine and vitamins", idTitle: "Obat dan vitamin", category: "Kesehatan", date: "2026-10-12", amount: 180000, kind: "expense", emoji: "🌿" },
  { id: 11, title: "Home internet", idTitle: "Internet rumah", category: "Tagihan", date: "2026-10-11", amount: 435000, kind: "expense", emoji: "⚡" },
  { id: 12, title: "Family dinner", idTitle: "Makan bersama keluarga", category: "Makanan", date: "2026-10-09", amount: 607000, kind: "expense", emoji: "🍜" },
  { id: 13, title: "Motorcycle service", idTitle: "Servis motor", category: "Lainnya", date: "2026-10-06", amount: 1025000, kind: "expense", emoji: "🧾" },
];

const categoryEmojis: Record<string, string> = {
  Gaji: "💼", Makanan: "🍜", Belanja: "🛍️", Transportasi: "🛵", Tagihan: "⚡", Freelance: "✨", Lainnya: "🧾",
};

export function fromDatabase(row: DatabaseTransaction): Transaction {
  return {
    id: row.id,
    title: row.description,
    category: row.category,
    date: row.transaction_date,
    amount: Number(row.amount),
    kind: row.kind,
    emoji: categoryEmojis[row.category] ?? "🧾",
  };
}

export function transactionToDatabase(transaction: NewTransaction) {
  return {
    kind: transaction.kind,
    amount: transaction.amount,
    category: transaction.category,
    description: transaction.title,
    transaction_date: transaction.date,
  };
}

export function categoryLabel(category: string, language: "en" | "id") {
  if (language === "id") return category;
  const labels: Record<string, string> = {
    Gaji: "Salary", Makanan: "Food", Belanja: "Shopping", Transportasi: "Transport", Tagihan: "Bills",
    Freelance: "Freelance", Lainnya: "Other", "Kategori lain": "Other categories", Hiburan: "Entertainment", Kesehatan: "Health",
  };
  return labels[category] ?? category;
}

export function formatTransactionDate(value: string, locale: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short" });
}
