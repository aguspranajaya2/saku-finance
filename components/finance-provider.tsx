"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { demoTransactions, fromDatabase, transactionToDatabase, type DatabaseTransaction, type NewTransaction, type Transaction } from "@/lib/finance";
import { createClient } from "@/lib/supabase/client";

const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

type FinanceContextValue = {
  configured: boolean;
  transactions: Transaction[];
  loading: boolean;
  loadError: "query" | "connection" | "";
  saving: boolean;
  saveError: "session" | "save" | "";
  clearSaveError: () => void;
  saveTransaction: (transaction: NewTransaction) => Promise<boolean>;
};

const FinanceContext = createContext<FinanceContextValue | null>(null);

function newestFirst(transactions: Transaction[]) {
  return [...transactions].sort((a, b) => b.date.localeCompare(a.date));
}

export function FinanceProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [transactions, setTransactions] = useState<Transaction[]>(configured ? [] : demoTransactions);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<FinanceContextValue["loadError"]>("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<FinanceContextValue["saveError"]>("");

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) {
      setLoading(false);
      return;
    }
    let active = true;
    async function load() {
      try {
        const { data: auth, error: authError } = await supabase!.auth.getUser();
        if (!active) return;
        if (authError || !auth.user) {
          setTransactions([]);
          router.replace("/login");
          return;
        }
        setUserId(auth.user.id);
        const { data, error } = await supabase!.from("transactions")
          .select("id, kind, amount, category, description, transaction_date")
          .eq("user_id", auth.user.id)
          .order("transaction_date", { ascending: false });
        if (!active) return;
        if (error) {
          setTransactions([]);
          setLoadError("query");
        } else {
          setTransactions((data ?? []).map((row: DatabaseTransaction) => fromDatabase(row)));
        }
      } catch {
        if (active) {
          setTransactions([]);
          setLoadError("connection");
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [router]);

  async function saveTransaction(transaction: NewTransaction) {
    if (saving) return false;
    setSaving(true);
    setSaveError("");
    try {
      if (configured) {
        const supabase = createClient();
        if (!supabase || !userId) {
          setSaveError("session");
          return false;
        }
        const { data, error } = await supabase.from("transactions")
          .insert({ ...transactionToDatabase(transaction), user_id: userId })
          .select("id, kind, amount, category, description, transaction_date")
          .single();
        if (error) {
          setSaveError("save");
          return false;
        }
        setTransactions((current) => newestFirst([fromDatabase(data as DatabaseTransaction), ...current]));
      } else {
        setTransactions((current) => newestFirst([{ ...transaction, id: crypto.randomUUID(), emoji: "🧾" }, ...current]));
      }
      return true;
    } catch {
      setSaveError("save");
      return false;
    } finally {
      setSaving(false);
    }
  }

  return <FinanceContext.Provider value={{ configured, transactions, loading, loadError, saving, saveError, clearSaveError: () => setSaveError(""), saveTransaction }}>{children}</FinanceContext.Provider>;
}

export function useFinance() {
  const context = useContext(FinanceContext);
  if (!context) throw new Error("useFinance must be used within FinanceProvider");
  return context;
}
