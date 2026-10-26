const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const loadTypeScript = require("./helpers/load-typescript.cjs");
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function row(id) { return { id, kind: "expense", amount: 25000, category: "Makanan", description: `Receipt ${id}`, transaction_date: "2026-10-26" }; }

// A small hook host runs the real provider without a DOM or live Supabase.
function mountFinance() {
  const browser = new EventTarget();
  const document = new EventTarget();
  document.visibilityState = "visible";
  let authCallback;
  let insideAuthCallback = false;
  let user = { id: "A", email: "a@example.test" };
  const reads = [];
  const writes = [];
  const navigations = [];
  const client = {
    auth: {
      getUser: async () => {
        assert.equal(insideAuthCallback, false, "Auth SDK must run outside its auth callback lock");
        return { data: { user }, error: null };
      },
      onAuthStateChange(callback) {
        authCallback = callback;
        return { data: { subscription: { unsubscribe() { authCallback = null; } } } };
      },
    },
    from(table) {
      assert.equal(table, "transactions");
      return {
        select() { return { eq(column, account) { assert.equal(column, "user_id"); return { order() { const request = { account, ...deferred() }; reads.push(request); return request.promise; } }; } }; },
        insert(payload) { return { select() { return { single() { const request = { payload, ...deferred() }; writes.push(request); return request.promise; } }; } }; },
      };
    },
  };
  const sessionModule = loadTypeScript("lib/verified-session.ts", { globals: { window: browser, document } });
  const slots = [];
  const effects = [];
  let cursor = 0;
  let output;
  const pendingEffects = [];
  const hooks = {
    createContext: () => ({ Provider: "Provider" }),
    useContext() { throw new Error("Not used by provider"); },
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      const previous = effects[index];
      if (!previous || dependencies.some((value, position) => value !== previous.dependencies[position])) {
        pendingEffects.push(() => { previous?.cleanup?.(); effects[index] = { dependencies, cleanup: effect() }; });
      }
    },
  };
  const filename = path.resolve("components/finance-provider.tsx");
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, fileName: filename }).outputText;
  const module = { exports: {} };
  const router = { replace: value => navigations.push(value) };
  const modules = {
    react: hooks,
    "react/jsx-runtime": { jsx: (type, props) => ({ type, props }) },
    "next/navigation": { useRouter: () => router },
    "@/lib/finance": loadTypeScript("lib/finance.ts"),
    "@/lib/supabase/client": { createClient: () => client },
    "@/lib/verified-session": sessionModule,
  };
  vm.runInNewContext(source, { module, exports: module.exports, require: name => modules[name], process: { env: { NEXT_PUBLIC_SUPABASE_URL: "https://example.test", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-only" } }, console }, { filename });
  function render() {
    cursor = 0;
    output = module.exports.FinanceProvider({ children: null });
    while (pendingEffects.length) pendingEffects.shift()();
    return output.props.value;
  }
  render();
  return {
    reads, writes, navigations,
    value: render,
    changeAccount(account) {
      user = account ? { id: account, email: `${account.toLowerCase()}@example.test` } : null;
      insideAuthCallback = true;
      try { authCallback(account ? "SIGNED_IN" : "SIGNED_OUT", user ? { user } : null); }
      finally { insideAuthCallback = false; }
    },
    focus() { browser.dispatchEvent(new Event("focus")); },
    dispose() { for (const effect of effects) effect?.cleanup?.(); },
  };
}

test("switching A to B clears cached records and ignores a late A load", async () => {
  const app = mountFinance();
  try {
    await tick();
    assert.equal(app.reads[0].account, "A");
    app.changeAccount("B");
    assert.equal(app.value().transactions.length, 0);
    await tick();
    assert.equal(app.reads[1].account, "B");
    app.reads[1].resolve({ data: [row("B-record")], error: null });
    await tick();
    assert.equal(app.value().transactions[0].id, "B-record");
    app.reads[0].resolve({ data: [row("A-private")], error: null });
    await tick();
    assert.equal(app.value().transactions.length, 1);
    assert.equal(app.value().transactions[0].id, "B-record");
  } finally { app.dispose(); }
});

test("an in-flight insert from A cannot append to B or reset B's save state", async () => {
  const app = mountFinance();
  try {
    await tick();
    app.reads[0].resolve({ data: [row("A-record")], error: null });
    await tick();
    const saveA = app.value().saveTransaction({ title: "A transaction", amount: 25000, kind: "expense", category: "Makanan", date: "2026-10-26" });
    await tick();
    assert.equal(app.writes[0].payload.user_id, "A");
    assert.equal(Object.hasOwn(app.writes[0].payload, "source"), false);
    app.changeAccount("B");
    assert.equal(app.value().transactions.length, 0);
    await tick();
    app.reads[1].resolve({ data: [row("B-record")], error: null });
    await tick();
    const saveB = app.value().saveTransaction({ title: "B transaction", amount: 30000, kind: "expense", category: "Makanan", date: "2026-10-26" });
    await tick();
    app.writes[0].resolve({ data: row("A-insert"), error: null });
    assert.equal(await saveA, false);
    assert.equal(app.value().saving, true);
    assert.equal(app.value().transactions[0].id, "B-record");
    app.writes[1].resolve({ data: row("B-insert"), error: null });
    assert.equal(await saveB, true);
    assert.equal(app.value().saving, false);
    assert.equal(app.value().transactions.some(item => item.id.startsWith("A-")), false);
  } finally { app.dispose(); }
});

test("focus clears account data before verification and sign out clears it immediately", async () => {
  const app = mountFinance();
  try {
    await tick();
    app.reads[0].resolve({ data: [row("A-record")], error: null });
    await tick();
    assert.equal(app.value().transactions.length, 1);
    app.focus();
    assert.equal(app.value().transactions.length, 0);
    assert.equal(app.value().loading, true);
    await tick();
    app.reads[1].resolve({ data: [row("A-refreshed")], error: null });
    await tick();
    app.changeAccount(null);
    assert.equal(app.value().transactions.length, 0);
    assert.equal(app.value().saving, false);
    assert.equal(app.navigations.at(-1), "/login");
  } finally { app.dispose(); }
});
