const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { createHash } = require("node:crypto");
const { PGlite } = require("@electric-sql/pglite");

// Real PostgreSQL permissions/RLS/functions, using synthetic local users only.
const USER_A = "10000000-0000-4000-8000-000000000001";
const USER_B = "10000000-0000-4000-8000-000000000002";
const CHAT_A = 101;
const CHAT_B = 202;
let db;

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    grant usage on schema public, auth to anon, authenticated, service_role;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}');
    create function auth.uid() returns uuid language sql stable set search_path = '' as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `);
  for (const name of ["202610250001_initial_schema.sql", "202610260001_usernames.sql"]) {
    await db.exec(readFileSync(join(__dirname, "..", "supabase", "migrations", name), "utf8"));
  }
  // Simulate older installations with explicit column grants as well as table grants.
  await db.exec(`grant insert (source, telegram_update_id, receipt_storage_path),
    update (user_id, source, telegram_update_id, receipt_storage_path) on public.transactions to authenticated;`);
  await db.exec(readFileSync(join(__dirname, "..", "supabase", "migrations", "202610260002_security_hardening.sql"), "utf8"));
});

beforeEach(async () => {
  await db.exec("truncate auth.users cascade; truncate public.security_rate_limits;");
  await db.query("insert into auth.users (id, email) values ($1, 'alice@example.invalid'), ($2, 'bob@example.invalid')", [USER_A, USER_B]);
});

after(async () => { await db?.close(); });

async function asRole(role, userId, action) {
  assert.ok(["anon", "authenticated", "service_role"].includes(role));
  await db.exec(`begin; set local role ${role};`);
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId || ""]);
    const result = await action();
    await db.exec("commit");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}

const denied = (action) => assert.rejects(action, (error) => error.code === "42501");
async function scalar(sql, args = []) { return (await db.query(sql, args)).rows[0].result; }
async function service(sql, args = []) { return asRole("service_role", null, () => scalar(sql, args)); }
async function connect(userId = USER_A, chatId = CHAT_A) {
  await db.query("insert into public.telegram_connections (user_id, chat_id) values ($1, $2)", [userId, chatId]);
}
async function pending(updateId, userId = USER_A, chatId = CHAT_A, expired = false) {
  return scalar(`insert into public.pending_receipts
    (user_id, chat_id, telegram_update_id, merchant, amount, category, transaction_date, confidence, expires_at)
    values ($1, $2, $3, 'Local Test Shop', 25000, 'Belanja', '2026-10-26', 90,
      now() + case when $4 then interval '-1 minute' else interval '10 minutes' end)
    returning id as result`, [userId, chatId, updateId, expired]);
}
async function claim(updateId, userId = USER_A, chatId = CHAT_A) {
  return service("select public.claim_receipt_job($1, $2, $3) as result", [updateId, userId, chatId]);
}
async function finish(updateId, leaseId, userId = USER_A) {
  return service("select public.finish_receipt_job($1, $2, $3) as result", [updateId, userId, leaseId]);
}
async function consume(limits) {
  return service("select public.consume_security_limits($1::jsonb) as result", [JSON.stringify(limits)]);
}
function bucket(character, limit = 2, window = 60) {
  return { key: character.repeat(64), limit, window_seconds: window };
}
function ocrKey(window, userId = USER_A) {
  const md5 = (text) => createHash("md5").update(text).digest("hex");
  return md5(`saku:ocr:${window}:${userId}`) + md5(`saku:ocr:${window}:scope:${userId}`);
}

test("authenticated transactions keep business-field access and isolate two users with RLS", async () => {
  const id = await asRole("authenticated", USER_A, () => scalar(`insert into public.transactions
    (user_id, kind, amount, category, description, transaction_date)
    values ($1, 'expense', 12000, 'Food', 'Lunch', '2026-10-26') returning id as result`, [USER_A]));
  assert.equal(await asRole("authenticated", USER_A, () => scalar("select source as result from public.transactions where id = $1", [id])), "web");
  assert.deepEqual(await asRole("authenticated", USER_B, () => db.query("select * from public.transactions where id = $1", [id])).then((r) => r.rows), []);
  assert.deepEqual(await asRole("authenticated", USER_B, () => db.query("update public.transactions set amount = 1 where id = $1 returning id", [id])).then((r) => r.rows), []);
  assert.deepEqual(await asRole("authenticated", USER_B, () => db.query("delete from public.transactions where id = $1 returning id", [id])).then((r) => r.rows), []);
  await denied(() => asRole("authenticated", USER_B, () => db.query(`insert into public.transactions
    (user_id, kind, amount, category, description, transaction_date)
    values ($1, 'income', 1, 'Other', 'Forged owner', current_date)`, [USER_A])));
  assert.equal(await asRole("authenticated", USER_A, () => scalar("update public.transactions set amount = 15000 where id = $1 returning amount as result", [id])), 15000);
  await asRole("authenticated", USER_A, () => db.query("delete from public.transactions where id = $1", [id]));
  assert.equal(await scalar("select count(*)::int as result from public.transactions"), 0);
});

test("clients cannot forge IDs, owners, origins, update deduplication IDs, or storage metadata", async () => {
  const id = await scalar(`insert into public.transactions (user_id, kind, amount, category, description, transaction_date)
    values ($1, 'income', 100, 'Other', 'Test', current_date) returning id as result`, [USER_A]);
  const protectedValues = [
    ["id", "'20000000-0000-4000-8000-000000000001'::uuid"],
    ["source", "'telegram'"], ["telegram_update_id", "500"],
    ["receipt_storage_path", "'private/forged.jpg'"], ["created_at", "now()"],
  ];
  for (const [column, value] of protectedValues) {
    await denied(() => asRole("authenticated", USER_A, () => db.query(`insert into public.transactions
      (user_id, kind, amount, category, description, transaction_date, ${column})
      values ($1, 'expense', 1, 'Other', 'Attempt', current_date, ${value})`, [USER_A])));
    await denied(() => asRole("authenticated", USER_A, () => db.query(`update public.transactions set ${column} = ${value} where id = $1`, [id])));
  }
  await denied(() => asRole("authenticated", USER_A, () => db.query("update public.transactions set user_id = $1 where id = $2", [USER_B, id])));
});

test("private bot state, persistent counters, and privileged RPCs are inaccessible to clients", async () => {
  for (const role of ["anon", "authenticated"]) {
    for (const table of ["telegram_connections", "telegram_pairing_codes", "pending_receipts", "security_rate_limits", "receipt_processing_jobs"]) {
      await denied(() => asRole(role, USER_A, () => db.query(`select * from public.${table}`)));
      await denied(() => asRole(role, USER_A, () => db.query(`delete from public.${table}`)));
    }
    for (const [sql, args] of [
      ["select public.consume_security_limits($1::jsonb)", [JSON.stringify([bucket("a")])]],
      ["select public.claim_receipt_job(1, $1, 101)", [USER_A]],
      ["select public.finish_receipt_job(1, $1, $1)", [USER_A]],
      ["select public.confirm_pending_receipt($1, 101)", [USER_A]],
      ["select public.cancel_pending_receipt($1, 101)", [USER_A]],
      ["select public.redeem_telegram_pairing_code('test', 101)", []],
      ["select public.resolve_username_email('alice')", []],
    ]) await denied(() => asRole(role, USER_A, () => db.query(sql, args)));
  }
  await denied(() => asRole("anon", null, () => db.query("select public.disconnect_telegram()")));
  await denied(() => asRole("authenticated", null, () => db.query("select public.disconnect_telegram()")));
  const functions = await db.query(`select p.proname, p.proconfig from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef`);
  assert.ok(functions.rows.length >= 10);
  for (const fn of functions.rows) assert.deepEqual(fn.proconfig, ['search_path=""'], fn.proname);
});

test("receipt confirmation inserts exactly one transaction and rejects expired or wrong-chat buttons", async () => {
  await connect();
  const id = await pending(500);
  assert.equal(await service("select public.confirm_pending_receipt($1, $2) as result", [id, CHAT_B]), "invalid");
  assert.equal(await service("select public.confirm_pending_receipt($1, $2) as result", [id, CHAT_A]), "confirmed");
  assert.equal(await service("select public.confirm_pending_receipt($1, $2) as result", [id, CHAT_A]), "invalid");
  const saved = (await db.query("select user_id, amount, source, telegram_update_id from public.transactions")).rows;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].user_id, USER_A);
  assert.equal(Number(saved[0].amount), 25000);
  assert.equal(saved[0].source, "receipt");
  const expired = await pending(501, USER_A, CHAT_A, true);
  assert.equal(await service("select public.confirm_pending_receipt($1, $2) as result", [expired, CHAT_A]), "invalid");
  assert.equal(await service("select public.cancel_pending_receipt($1, $2) as result", [expired, CHAT_A]), "invalid");
});

test("an unrelated update-ID collision never reports a receipt as saved", async () => {
  await connect();
  const id = await pending(502);
  await db.query(`insert into public.transactions
    (user_id, kind, amount, category, description, transaction_date, source, telegram_update_id)
    values ($1, 'expense', 1, 'Other', 'Unrelated record', current_date, 'telegram', 502)`, [USER_B]);
  assert.equal(await service("select public.confirm_pending_receipt($1, $2) as result", [id, CHAT_A]), "conflict");
  assert.equal(await scalar("select count(*)::int as result from public.pending_receipts where id = $1", [id]), 1);
  assert.equal(await scalar("select count(*)::int as result from public.transactions where user_id = $1", [USER_A]), 0);
});

test("same receipt saved by a prior attempt can be acknowledged idempotently", async () => {
  await connect();
  const id = await pending(503);
  await db.query(`insert into public.transactions
    (user_id, kind, amount, category, description, transaction_date, source, telegram_update_id)
    select user_id, 'expense', amount, category, merchant, transaction_date, 'receipt', telegram_update_id
    from public.pending_receipts where id = $1`, [id]);
  assert.equal(await service("select public.confirm_pending_receipt($1, $2) as result", [id, CHAT_A]), "confirmed");
  assert.equal(await scalar("select count(*)::int as result from public.transactions"), 1);
  assert.equal(await scalar("select count(*)::int as result from public.pending_receipts"), 0);
});

test("relinking invalidates old receipts and old-chat callbacks cannot act on a new binding", async () => {
  await connect();
  const original = await pending(504);
  await db.query("insert into public.telegram_pairing_codes (code_hash, user_id, expires_at) values ('relink', $1, now() + interval '5 minutes')", [USER_A]);
  const pairing = await asRole("service_role", null, () => db.query("select * from public.redeem_telegram_pairing_code('relink', $1)", [CHAT_B]));
  assert.equal(pairing.rows[0].status, "linked");
  assert.equal(await scalar("select count(*)::int as result from public.pending_receipts where id = $1", [original]), 0);
  // A worker started before relinking might insert later. Its callback still must fail.
  const lateOldChat = await pending(505);
  assert.equal(await service("select public.confirm_pending_receipt($1, $2) as result", [lateOldChat, CHAT_A]), "invalid");
  assert.equal(await service("select public.cancel_pending_receipt($1, $2) as result", [lateOldChat, CHAT_A]), "invalid");
  const current = await pending(506, USER_A, CHAT_B);
  assert.equal(await service("select public.cancel_pending_receipt($1, $2) as result", [current, CHAT_B]), "cancelled");
  assert.equal(await claim(507, USER_A, CHAT_A).then((r) => r.status), "unlinked");
});

test("disconnect uses the signed-in user, revokes pending actions, and preserves another account", async () => {
  await connect();
  await connect(USER_B, CHAT_B);
  const ownPending = await pending(508);
  const otherPending = await pending(509, USER_B, CHAT_B);
  await db.query("insert into public.telegram_pairing_codes (code_hash, user_id, expires_at) values ('own', $1, now() + interval '5 minutes')", [USER_A]);
  assert.equal(await asRole("authenticated", USER_A, () => scalar("select public.disconnect_telegram() as result")), true);
  assert.equal(await scalar("select count(*)::int as result from public.telegram_connections where user_id = $1", [USER_A]), 0);
  assert.equal(await scalar("select count(*)::int as result from public.telegram_pairing_codes where user_id = $1", [USER_A]), 0);
  assert.equal(await scalar("select count(*)::int as result from public.pending_receipts where id = $1", [ownPending]), 0);
  assert.equal(await scalar("select count(*)::int as result from public.pending_receipts where id = $1", [otherPending]), 1);
  assert.equal(await scalar("select count(*)::int as result from public.telegram_connections where user_id = $1", [USER_B]), 1);
  assert.equal(await service("select public.confirm_pending_receipt($1, $2) as result", [ownPending, CHAT_A]), "invalid");
  assert.equal(await claim(510).then((r) => r.status), "unlinked");
});

test("pairing conflicts roll back receipt invalidation, while a successful same-chat pairing revokes old buttons", async () => {
  await connect();
  await connect(USER_B, CHAT_B);
  const id = await pending(511);
  await db.query("insert into public.telegram_pairing_codes (code_hash, user_id, expires_at) values ('pair-again', $1, now() + interval '5 minutes')", [USER_A]);
  const conflict = await asRole("service_role", null, () => db.query("select * from public.redeem_telegram_pairing_code('pair-again', $1)", [CHAT_B]));
  assert.equal(conflict.rows[0].status, "chat_in_use");
  assert.equal(await scalar("select chat_id as result from public.telegram_connections where user_id = $1", [USER_A]), CHAT_A);
  assert.equal(await scalar("select count(*)::int as result from public.pending_receipts where id = $1", [id]), 1);
  assert.equal(await scalar("select count(*)::int as result from public.telegram_pairing_codes where user_id = $1", [USER_A]), 1);
  const success = await asRole("service_role", null, () => db.query("select * from public.redeem_telegram_pairing_code('pair-again', $1)", [CHAT_A]));
  assert.equal(success.rows[0].status, "linked");
  assert.equal(await scalar("select count(*)::int as result from public.pending_receipts where id = $1", [id]), 0);
});

test("persistent rate limits consume an entire batch atomically and reset after expiry", async () => {
  const first = bucket("a", 1), second = bucket("b", 5), newBucket = bucket("c", 1);
  assert.deepEqual(await consume([first, second]), { allowed: true, retry_after: 0 });
  const deniedBatch = await consume([newBucket, first, second]);
  assert.equal(deniedBatch.allowed, false);
  assert.ok(deniedBatch.retry_after >= 1 && deniedBatch.retry_after <= 60);
  assert.deepEqual((await db.query("select bucket_key, request_count from public.security_rate_limits order by bucket_key")).rows,
    [{ bucket_key: first.key, request_count: 1 }, { bucket_key: second.key, request_count: 1 }]);
  await db.query("update public.security_rate_limits set expires_at = now() - interval '1 second' where bucket_key = $1", [first.key]);
  assert.deepEqual(await consume([second, first]), { allowed: true, retry_after: 0 });
  assert.equal(await scalar("select request_count as result from public.security_rate_limits where bucket_key = $1", [first.key]), 1);
  assert.equal(await scalar("select request_count as result from public.security_rate_limits where bucket_key = $1", [second.key]), 2);
});

test("rate limit requests validate bucket keys, quotas, windows, and duplicates", async () => {
  for (const invalid of [[], [bucket("z")], [bucket("a", 0)], [bucket("a", 10001)], [bucket("a", 1, 86401)], [bucket("a"), bucket("a")]]) {
    await assert.rejects(() => consume(invalid), (error) => error.code === "22023");
  }
  assert.equal(await scalar("select count(*)::int as result from public.security_rate_limits"), 0);
});

test("persistent counter cleanup removes a bounded number of stale rows per successful call", async () => {
  await db.exec(`insert into public.security_rate_limits (bucket_key, request_count, expires_at)
    select md5(i::text) || md5('cleanup:' || i::text), 1, now() - interval '2 days' from generate_series(1, 117) i;`);
  assert.equal((await consume([bucket("a")])).allowed, true);
  assert.equal(await scalar("select count(*)::int as result from public.security_rate_limits where expires_at < now()"), 17);
  assert.equal(await scalar("select request_count as result from public.security_rate_limits where bucket_key = $1", [bucket("a").key]), 1);
});

test("OCR leases bound global concurrency, deduplicate updates, and require the matching owner/token", async () => {
  await connect();
  await connect(USER_B, CHAT_B);
  const first = await claim(600);
  const second = await claim(601, USER_B, CHAT_B);
  assert.equal(first.status, "claimed");
  assert.match(first.lease_id, /^[a-f0-9-]{36}$/);
  assert.equal(second.status, "claimed");
  assert.equal(await claim(600).then((r) => r.status), "duplicate");
  assert.equal(await claim(600, USER_B, CHAT_B).then((r) => r.status), "duplicate");
  assert.equal(await claim(602).then((r) => r.status), "busy");
  assert.equal(await scalar("select request_count as result from public.security_rate_limits where bucket_key = $1", [ocrKey("minute")]), 1);
  assert.equal(await finish(600, first.lease_id, USER_B), false);
  assert.equal(await finish(600, USER_B), false);
  assert.equal(await claim(602).then((r) => r.status), "busy");
  assert.equal(await finish(600, first.lease_id), true);
  assert.equal(await finish(600, first.lease_id), false);
  assert.equal(await claim(600).then((r) => r.status), "duplicate");
  assert.equal(await claim(602).then((r) => r.status), "claimed");
  assert.equal(await scalar("select count(*)::int as result from public.transactions"), 0, "job completion is not transaction confirmation");
});

test("expired OCR leases can retry safely without a stale worker releasing the replacement lease", async () => {
  await connect();
  const original = await claim(610);
  await db.query("update public.receipt_processing_jobs set lease_expires_at = now() - interval '1 second' where telegram_update_id = 610");
  const replacement = await claim(610);
  assert.equal(replacement.status, "claimed");
  assert.notEqual(replacement.lease_id, original.lease_id);
  assert.equal(await finish(610, original.lease_id), false);
  assert.equal(await scalar("select status as result from public.receipt_processing_jobs where telegram_update_id = 610"), "processing");
  assert.equal(await finish(610, replacement.lease_id), true);
});

test("OCR limits persist after jobs finish and enforce both three per minute and twenty per day", async () => {
  await connect();
  for (let id = 620; id < 623; id++) {
    const lease = await claim(id);
    assert.equal(lease.status, "claimed");
    assert.equal(await finish(id, lease.lease_id), true);
  }
  assert.equal(await claim(623).then((r) => r.status), "rate_limited");
  await db.query("update public.security_rate_limits set expires_at = now() - interval '1 second' where bucket_key = $1", [ocrKey("minute")]);
  await db.query("update public.security_rate_limits set request_count = 19 where bucket_key = $1", [ocrKey("day")]);
  const twentieth = await claim(624);
  assert.equal(twentieth.status, "claimed");
  await finish(624, twentieth.lease_id);
  assert.equal(await claim(625).then((r) => r.status), "rate_limited");
  assert.equal(await scalar("select request_count as result from public.security_rate_limits where bucket_key = $1", [ocrKey("minute")]), 1, "blocked daily quota does not consume a minute quota");
});

test("OCR replay checks pending or saved receipts even after an old job marker has expired", async () => {
  await connect();
  await pending(630);
  assert.equal(await claim(630).then((r) => r.status), "duplicate");
  await db.query(`insert into public.transactions
    (user_id, kind, amount, category, description, transaction_date, source, telegram_update_id)
    values ($1, 'expense', 1, 'Other', 'Saved', current_date, 'receipt', 631)`, [USER_A]);
  assert.equal(await claim(631).then((r) => r.status), "duplicate");
  assert.equal(await scalar("select count(*)::int as result from public.security_rate_limits"), 0);
});

test("OCR job cleanup is bounded and preserves a freshly claimed lease", async () => {
  await connect();
  await db.query(`insert into public.receipt_processing_jobs
    (telegram_update_id, user_id, chat_id, status, lease_id, lease_expires_at, completed_at)
    select i, $1, $2, 'done', gen_random_uuid(), now() - interval '8 days', now() - interval '8 days'
    from generate_series(1000, 1101) i`, [USER_A, CHAT_A]);
  const lease = await claim(1102);
  assert.equal(lease.status, "claimed");
  assert.equal(await scalar("select count(*)::int as result from public.receipt_processing_jobs where lease_expires_at < now()"), 2);
  assert.equal(await finish(1102, lease.lease_id), true);
});
