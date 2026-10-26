import type { SupabaseClient, User } from "@supabase/supabase-js";

type SessionCallbacks = {
  onInvalidated: () => void;
  onUser: (user: User, isCurrent: () => boolean) => void | Promise<void>;
  onSignedOut: () => void;
  onError: () => void;
};

// Auth callbacks only invalidate state and enqueue work. Calling another Auth
// method inside the callback can deadlock the client's auth lock.
export function watchVerifiedSession(client: SupabaseClient, callbacks: SessionCallbacks) {
  let active = true;
  let revision = 0;
  let userId: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function invalidate() {
    revision += 1;
    userId = null;
    callbacks.onInvalidated();
  }

  async function verify() {
    const version = ++revision;
    const isCurrent = () => active && revision === version;
    try {
      const { data, error } = await client.auth.getUser();
      if (!isCurrent()) return;
      if (error || !data.user) {
        invalidate();
        callbacks.onSignedOut();
        return;
      }
      if (userId !== data.user.id) callbacks.onInvalidated();
      userId = data.user.id;
      await callbacks.onUser(data.user, isCurrent);
    } catch {
      if (!isCurrent()) return;
      invalidate();
      callbacks.onError();
    }
  }

  function schedule() {
    if (!active) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void verify();
    }, 0);
  }

  const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
    if (!active) return;
    if (event === "SIGNED_OUT") {
      if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
      invalidate();
      callbacks.onSignedOut();
      return;
    }
    if ((session?.user.id ?? null) !== userId) invalidate();
    schedule();
  });
  const refresh = () => { if (active) { invalidate(); schedule(); } };
  const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", onVisible);
  schedule();

  return {
    refresh,
    dispose() {
      active = false;
      revision += 1;
      if (timer !== undefined) clearTimeout(timer);
      subscription.unsubscribe();
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    },
  };
}
