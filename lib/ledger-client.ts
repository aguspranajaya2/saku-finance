import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeEntry, validateJournal, type JournalEntry, type LedgerAccount } from "@/lib/ledger";

// PostgREST defaults to 1,000 rows. Never silently truncate financial statements.
export async function readLedger(client: SupabaseClient, userId: string, isCurrent: () => boolean) {
  async function pages(table: string, columns: string) {
    const result: unknown[] = [];
    for (let offset = 0; ; offset += 1000) {
      if (!isCurrent()) return null;
      const { data, error } = await client.from(table).select(columns).eq("user_id", userId)
        .order("created_at", { ascending: true }).order("id", { ascending: true }).range(offset, offset + 999);
      if (error) throw error;
      result.push(...(data ?? []));
      if ((data?.length ?? 0) < 1000) return result;
    }
  }
  let accounts = await pages("ledger_accounts", "id,code,name,account_type,role,created_at");
  if (!accounts || !isCurrent()) return null;
  const entries = await pages("journal_entries", "id,entry_date,memo,entry_type,category,source,created_at,reversal_of,reversed_by,journal_lines(account_id,debit,credit,line_no)");
  if (!entries || !isCurrent()) return null;
  const normalized = (entries as JournalEntry[]).map(normalizeEntry);
  if (normalized.some(e => !validateJournal(e.journal_lines))) throw new Error("Incomplete journal data.");
  const known = new Set((accounts as LedgerAccount[]).map(a => a.id));
  // Another tab may create an account and post while these pages are loading.
  if (normalized.some(e => e.journal_lines.some(l => !known.has(l.account_id)))) {
    accounts = await pages("ledger_accounts", "id,code,name,account_type,role,created_at");
    if (!accounts || !isCurrent()) return null;
    const refreshed = new Set((accounts as LedgerAccount[]).map(a => a.id));
    if (normalized.some(e => e.journal_lines.some(l => !refreshed.has(l.account_id)))) throw new Error("Incomplete account data.");
  }
  return { accounts: (accounts as LedgerAccount[]).sort((a, b) => a.code.localeCompare(b.code)), entries: normalized };
}
