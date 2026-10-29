"use client";
import { useState } from "react";
import styles from "./ledger-overview.module.css";
import Link from "next/link";
import { useLedger } from "@/components/ledger-provider";
import { JournalDialog } from "@/components/journal-dialog";
import { JournalList, LedgerStatus, useLedgerText } from "@/components/ledger-ui";
import { accountBalances, entryEffects, incomeStatementEntries, isCash, periodSummary, todayDate } from "@/lib/ledger";

export default function OverviewPage() {
  const { accounts, entries, loading, clearError } = useLedger(); const { t, money, amountsHidden, language } = useLedgerText();
  const [open, setOpen] = useState(false), [month, setMonth] = useState(() => todayDate().slice(0, 7));
  const [year, number] = month.split("-").map(Number);
  const start = `${month}-01`, end = `${month}-${new Date(year, number, 0).getDate()}`;
  const period = periodSummary(accounts, entries, start, end), balances = accountBalances(accounts, entries, todayDate());
  const cash = balances.filter(isCash).reduce((s, a) => s + a.balance, 0n);
  const debts = balances.filter(a => a.account_type === "liability").reduce((s, a) => s + a.balance, 0n);
  const receivables = balances.filter(a => a.role === "receivable").reduce((s, a) => s + a.balance, 0n);
  const groups = new Map<string, bigint>();
  incomeStatementEntries(entries, start, end).forEach(e => { const value = entryEffects(accounts, e).expense; groups.set(e.category, (groups.get(e.category) ?? 0n) + value); });
  const categories = [...groups].filter(([, value]) => value > 0n).sort((a, b) => a[1] > b[1] ? -1 : a[1] < b[1] ? 1 : 0).slice(0, 5);
  const chartEnd = end < todayDate() ? end : todayDate();
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(`${chartEnd}T12:00:00Z`); date.setUTCDate(date.getUTCDate() - 6 + i);
    const key = date.toISOString().slice(0, 10), sum = periodSummary(accounts, entries, key, key);
    return { key, ...sum };
  });
  const max = Math.max(1, ...days.flatMap(day => [Number(day.cashIn), Number(day.cashOut)]));
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const chartMax = Math.max(100, (Math.floor(max / magnitude) + 1) * magnitude);
  const axis = new Intl.NumberFormat(language === "en" ? "en-US" : "id-ID", { notation: "compact", maximumFractionDigits: 1 });
  function metricMoney(value: bigint) {
    const formatted = money.format(value), parts = formatted.match(/^(-?)(IDR|Rp)\s*(.+)$/u);
    return parts ? <><span className={styles.currency}>{parts[2]}</span><span className={styles.amount}>{parts[1]}{parts[3]}</span></> : formatted;
  }
  const recent = [...entries].sort((a, b) => b.entry_date.localeCompare(a.entry_date) || b.created_at.localeCompare(a.created_at)).slice(0, 5);
  return <div className={`page-content ledger-page ${styles.overview}`}>
    <div className={styles.heading}>
      <div><h1 className={styles.title}>{t("Financial overview", "Ringkasan keuangan")}</h1><p className={styles.subtitle}>{t("Revenue, expenses and cash flow for the month.", "Pendapatan, beban, dan arus kas bulan ini.")}</p></div>
      <div className={styles.controls}>
        <label className={styles.period}><span>{t("Period", "Periode")}</span><input aria-label={t("Summary month", "Bulan ringkasan")} type="month" required value={month} onChange={e => { if (e.target.value) setMonth(e.target.value); }} /></label>
        <button className={styles.record} disabled={loading || !accounts.length} onClick={() => { clearError(); setOpen(true); }} type="button"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>{t("Record activity", "Catat aktivitas")}</button>
      </div>
    </div>
    <LedgerStatus />
    {loading ? <div className={styles.skeleton} aria-label={t("Loading your books", "Memuat pembukuan")} aria-busy="true"><span /><span /><span /><span /></div> : <>
      <section className={styles.metrics} aria-label={t("Period summary", "Ringkasan periode")}>
        <article className={`${styles.metric} ${styles.cash}`}><span className={styles.metricLabel}>{t("Net cash flow", "Arus kas bersih")}</span><strong className={styles.metricValue}>{metricMoney(period.cashIn - period.cashOut)}</strong><p>{t("Cash received less cash paid", "Kas masuk dikurangi kas keluar")}</p></article>
        <article className={styles.metric}><span className={styles.metricLabel}>{t("Revenue", "Pendapatan")}</span><strong className={styles.metricValue}>{metricMoney(period.income)}</strong><p>{t("Excludes loans and capital", "Tanpa pokok pinjaman dan modal")}</p></article>
        <article className={styles.metric}><span className={styles.metricLabel}>{t("Expenses", "Beban")}</span><strong className={styles.metricValue}>{metricMoney(period.expense)}</strong><p>{t("Includes purchases on credit", "Termasuk pembelian secara kredit")}</p></article>
        <article className={`${styles.metric} ${styles.profit}`}><span className={styles.metricLabel}>{t("Net profit / loss", "Laba / rugi bersih")}</span><strong className={styles.metricValue}>{metricMoney(period.income - period.expense)}</strong><p>{t("Revenue less expenses", "Pendapatan dikurangi beban")}</p></article>
      </section>
      <section className={styles.positions} aria-label={t("Current balances", "Saldo saat ini")}>
        <Link className={styles.accountLink} href="/accounts"><span>{t("Cash & bank · today", "Kas & bank · hari ini")}</span><strong>{money.format(cash)}</strong></Link>
        <Link className={styles.accountLink} href="/debts"><span>{t("Outstanding liabilities", "Saldo kewajiban")}</span><strong>{money.format(debts)}</strong></Link>
        <Link className={styles.accountLink} href="/debts"><span>{t("Receivables", "Piutang")}</span><strong>{money.format(receivables)}</strong></Link>
      </section>
      <section className={styles.insights}>
        <article className={styles.panel}>
          <div className={styles.sectionHeading}><div><h2>{t("Cash movement", "Pergerakan kas")}</h2><p>{t("7 days ending", "7 hari sampai")} {chartEnd} · IDR</p></div></div>
          {amountsHidden ? <div className={styles.privateChart}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>{t("Amounts are hidden", "Nominal disembunyikan")}</div> : <>
            <div className={styles.legend}><span><i />{t("Cash in", "Kas masuk")}</span><span><i className={styles.outgoing} />{t("Cash out", "Kas keluar")}</span></div>
            <div className={styles.chart} role="group" aria-label={t("Daily cash received and paid", "Kas masuk dan keluar harian")}>
              <div className={styles.scale} aria-hidden="true"><span>{axis.format(chartMax / 100)}</span><span>{axis.format(chartMax / 200)}</span><span>0</span></div>
              <div className={styles.bars}>{days.map(day => <div className={styles.day} key={day.key}><div className={styles.barPair}><i className={styles.bar} style={{ height: `${Number(day.cashIn) / chartMax * 100}%` }} role="img" aria-label={`${day.key} · ${t("Cash in", "Kas masuk")}: ${money.format(day.cashIn)}`} title={money.format(day.cashIn)} /><i className={`${styles.bar} ${styles.outgoing}`} style={{ height: `${Number(day.cashOut) / chartMax * 100}%` }} role="img" aria-label={`${day.key} · ${t("Cash out", "Kas keluar")}: ${money.format(day.cashOut)}`} title={money.format(day.cashOut)} /></div><span>{day.key.slice(8)}</span></div>)}</div>
            </div>
          </>}
          <p className={styles.help}>{t("Own-account transfers net to zero. Opening balances are excluded.", "Transfer antar rekening sendiri bersaldo bersih nol. Saldo awal tidak termasuk arus kas.")}</p>
        </article>
        <article className={styles.panel}>
          <div className={styles.sectionHeading}><div><h2>{t("Expense categories", "Kategori beban")}</h2><p>{t("Selected period, after reversals", "Periode terpilih, setelah pembalik")}</p></div><Link className={styles.sectionLink} href="/reports">{t("Reports", "Laporan")} <span aria-hidden="true">↗</span></Link></div>
          <div className={styles.categories}>{categories.map(([category, value]) => <div className={styles.category} key={category}><div className={styles.categoryLabel}><span>{category}</span><strong>{money.format(value)}</strong></div>{!amountsHidden && <div className={styles.categoryTrack}><i style={{ width: `${Number(value) / Number(categories[0][1]) * 100}%` }} /></div>}</div>)}</div>
          {!categories.length && <p className={styles.help}>{t("No expenses in this period.", "Belum ada beban pada periode ini.")}</p>}
        </article>
      </section>
      <section className={`${styles.panel} ${styles.history}`}>
        <div className={styles.sectionHeading}><div><h2>{t("Recent journal entries", "Jurnal terbaru")}</h2><p>{t("Every entry has matching debit and credit totals", "Setiap jurnal memiliki total debit dan kredit yang sama")}</p></div><Link className={styles.sectionLink} href="/transactions">{t("All entries", "Semua jurnal")} <span aria-hidden="true">↗</span></Link></div><JournalList entries={recent} />
      </section>
    </>}
    <JournalDialog open={open} onClose={() => setOpen(false)} />
  </div>;
}
