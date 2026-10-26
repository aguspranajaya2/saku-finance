"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { TransactionDialog } from "@/components/transaction-dialog";
import { categoryLabel, formatTransactionDate, type NewTransaction } from "@/lib/finance";
import { usePreferences } from "@/lib/preferences";
import { useFinance } from "@/components/finance-provider";

type Filter = "all" | "income" | "expense";

export default function TransactionsPage() {
  const { language } = usePreferences();
  const locale = language === "en" ? "en-US" : "id-ID";
  const text = (en: string, id: string) => language === "en" ? en : id;
  const money = useMemo(() => new Intl.NumberFormat(locale, { style: "currency", currency: "IDR", maximumFractionDigits: 0 }), [locale]);
  const { transactions, configured, loading, loadError, saving, saveError, clearSaveError, saveTransaction } = useFinance();
  const [dialogOpen, setDialogOpen] = useState(false);
  const loadMessage = loadError === "query"
    ? text("Transactions could not load. Apply the Supabase database migration first.", "Transaksi tidak dapat dimuat. Terapkan migrasi database Supabase terlebih dahulu.")
    : text("Could not connect to your account. Check your connection and try again.", "Tidak dapat terhubung ke akun. Periksa koneksi lalu coba lagi.");
  const saveMessage = !saveError ? "" : saveError === "session"
    ? text("Your session is not ready. Refresh and try again.", "Sesi akun belum siap. Muat ulang lalu coba lagi.")
    : text("Could not save this entry. Please try again.", "Catatan gagal disimpan. Silakan coba lagi.");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [category, setCategory] = useState("all");
  const categories = useMemo(() => [...new Set(transactions.map((item) => item.category))].sort(), [transactions]);
  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return transactions.filter((item) => {
      const kindMatch = filter === "all" || item.kind === filter;
      const categoryMatch = category === "all" || item.category === category;
      const searchMatch = !search || `${item.title} ${item.idTitle ?? ""} ${item.category} ${categoryLabel(item.category, language)}`.toLowerCase().includes(search);
      return kindMatch && categoryMatch && searchMatch;
    });
  }, [transactions, filter, category, query, language]);

  async function handleSave(transaction: NewTransaction) {
    const saved = await saveTransaction(transaction);
    if (saved) {
      setQuery("");
      setFilter("all");
      setCategory("all");
    }
    return saved;
  }

  if (loading) return <div className="page-content"><div className="page-skeleton" /></div>;
  return (
    <div className="page-content transactions-page">
      <div className="page-heading">
        <div><div className="eyebrow">{text("YOUR ACTIVITY", "AKTIVITAS KEUANGAN")}</div><h1>{text("Transactions", "Transaksi")}</h1><p className="page-subtitle">{text("Search, review, and manage all your income and expenses.", "Cari, tinjau, dan kelola semua pemasukan serta pengeluaranmu.")}</p></div>
        <button className="primary-button" onClick={() => { clearSaveError(); setDialogOpen(true); }} type="button"><span className="button-plus">＋</span>{text("Add transaction", "Tambah transaksi")}</button>
      </div>
      {!configured && <div className="demo-note"><span className="demo-dot" />{text("Preview mode · sample transactions shown", "Mode pratinjau · menampilkan transaksi contoh")} <Link href="/login">{text("Set up an account", "Siapkan akun")}</Link></div>}
      {loadError && <div className="inline-notice">{loadMessage}</div>}

      <section className="transaction-overview-strip">
        <div><span>{text("All records", "Semua catatan")}</span><strong>{transactions.length}</strong></div>
        <div><span>{text("Income", "Pemasukan")}</span><strong className="positive">{money.format(transactions.filter((item) => item.kind === "income").reduce((sum, item) => sum + item.amount, 0))}</strong></div>
        <div><span>{text("Expenses", "Pengeluaran")}</span><strong>{money.format(transactions.filter((item) => item.kind === "expense").reduce((sum, item) => sum + item.amount, 0))}</strong></div>
      </section>

      <section className="panel transaction-manager">
        <div className="manager-toolbar">
          <div className="filter-tabs" role="group" aria-label={text("Filter transaction type", "Filter jenis transaksi")}>
            {(["all", "income", "expense"] as Filter[]).map((value) => <button aria-pressed={filter === value} className={filter === value ? "selected" : ""} key={value} onClick={() => setFilter(value)} type="button">{value === "all" ? text("All", "Semua") : value === "income" ? text("Income", "Pemasukan") : text("Expenses", "Pengeluaran")}</button>)}
          </div>
          <div className="transaction-search-controls">
            <label className="search-field"><span aria-hidden="true">⌕</span><input aria-label={text("Search transactions", "Cari transaksi")} onChange={(event) => setQuery(event.target.value)} placeholder={text("Search transactions", "Cari transaksi")} value={query} /></label>
            <label className="category-filter"><span className="visually-hidden">{text("Category", "Kategori")}</span><select aria-label={text("Filter by category", "Filter berdasarkan kategori")} onChange={(event) => setCategory(event.target.value)} value={category}><option value="all">{text("All categories", "Semua kategori")}</option>{categories.map((item) => <option key={item} value={item}>{categoryLabel(item, language)}</option>)}</select></label>
          </div>
        </div>
        <div className="transaction-table full-transaction-table">
          <div className="table-head"><span>{text("TRANSACTION", "TRANSAKSI")}</span><span>{text("CATEGORY", "KATEGORI")}</span><span>{text("DATE", "TANGGAL")}</span><span>{text("AMOUNT", "NOMINAL")}</span></div>
          {filtered.map((item) => <div className="transaction-row" key={item.id}><div className="transaction-title"><span className={`transaction-emoji ${item.kind}`}>{item.emoji}</span><strong>{language === "id" ? item.idTitle ?? item.title : item.title}</strong></div><span className="transaction-category">{categoryLabel(item.category, language)}</span><span className="transaction-date">{formatTransactionDate(item.date, locale)}</span><strong className={`transaction-amount ${item.kind}`}>{item.kind === "income" ? "+" : "−"}{money.format(item.amount)}</strong></div>)}
          {filtered.length === 0 && <div className="empty-state">{text("No matching transactions. Try a different search or filter.", "Tidak ada transaksi yang cocok. Coba kata kunci atau filter lain.")}</div>}
        </div>
        <div className="manager-footer"><span>{text("Showing", "Menampilkan")} {filtered.length} {text("of", "dari")} {transactions.length} {text("transactions", "transaksi")}</span><Link href="/settings">{text("Manage your preferences", "Kelola preferensi")} ›</Link></div>
      </section>
      <footer className="page-footer"><span>© 2026 Saku</span><span>{text("Your records stay private to your account", "Catatanmu hanya dapat diakses akunmu")}</span></footer>
      <TransactionDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onSave={handleSave} saving={saving} configured={Boolean(configured)} error={saveMessage} />
    </div>
  );
}
